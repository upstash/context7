import { createHash, randomBytes } from "node:crypto";
import * as jose from "jose";
import { redisCodeTaskStoreFromEnv } from "./code-task-redis.js";
import { isJWT } from "./jwt.js";
import type { CodeTool } from "./tool-names.js";
import type { ClientContext, CodeRequest, ContextResponse } from "./types.js";

// A code tool call that finds the source still being indexed can answer with an MCP task
// (the Tasks extension, SEP-2663) when the client declared the extension. The client then polls
// tasks/get, and the agent gets the real result when the index is done.
//
// The task ID is a short random string, because clients limit its length (Claude Code: 128
// characters) and send it as the Mcp-Name header. The task itself (the tool, its request, the
// caller) is a record in a store. tasks/get sends the request to the API again with the
// credential of the tasks/get call, so the API decides what that caller may read.

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

/** How long a task waits for the index. After it, tasks/get answers `failed`. */
export const CODE_TASK_WAIT_MS = 30 * 60 * 1000;
/** How long the store keeps a task, counted from its creation. Sent as `ttlMs`. */
export const CODE_TASK_TTL_MS = 60 * 60 * 1000;
/** The shortest poll interval. Claude Code polls at most every 30 seconds, whatever it is told. */
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 300;
/**
 * The shortest time between two requests to the API for one task. The API's poll pass gives 15
 * free requests in 10 minutes; with this gap a client that polls every 30 seconds causes 10.
 */
const MIN_CHECK_GAP_SECONDS = 45;
/** Claude Code accepts at most 128 printable ASCII characters. */
export const MAX_TASK_ID_LENGTH = 128;
const MAX_STATUS_MESSAGE_LENGTH = 300;

export type CodeTaskStatus = "working" | "completed" | "failed" | "cancelled";

/** A task as tasks/get returns it. With `resultType: "task"` it is also the tools/call answer. */
export type CodeTaskView = {
  taskId: string;
  status: CodeTaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number;
  pollIntervalMs: number;
  result?: unknown;
  error?: { code: number; message: string };
};

/** What the store keeps for a task. */
export interface CodeTaskRecord {
  tool: CodeTool;
  /** The request to /v2/code. */
  request: CodeRequest;
  /** Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** The caller (see callerBinding). */
  caller: string;
  pollSeconds: number;
  /** The last request to the API for this task; at creation, the tool call itself. */
  lastCheckAt: number;
  status: CodeTaskStatus;
  /** The API's latest "being indexed" message. */
  message: string;
  /** The tool result of a completed task. */
  result?: unknown;
  /** The JSON-RPC error of a failed task. */
  error?: { code: number; message: string };
}

/**
 * Where tasks live. A hosted server runs several pods and a tasks/get can reach any of them, so
 * its store must be one that all pods share (code-task-redis.ts).
 */
export interface CodeTaskStore {
  get(taskId: string): Promise<CodeTaskRecord | null>;
  /**
   * Writes the record. It is kept until CODE_TASK_TTL_MS after its creation. A task that has
   * ended is not written again: the first final status wins.
   */
  put(taskId: string, record: CodeTaskRecord): Promise<void>;
  /**
   * Sets `lastCheckAt` to `nowMs` and answers true when the last request to the API is at least
   * `gapMs` old. Atomic, so two polls at the same time cause one request.
   */
  claimCheck(taskId: string, nowMs: number, gapMs: number): Promise<boolean>;
}

/** Tasks in this process: right for stdio, where one process serves one client. */
export class MemoryCodeTaskStore implements CodeTaskStore {
  private readonly records = new Map<string, CodeTaskRecord>();

  constructor(private readonly maxTasks = 1000) {}

  async get(taskId: string, nowMs = Date.now()): Promise<CodeTaskRecord | null> {
    const record = this.records.get(taskId);
    if (!record) return null;
    if (nowMs - record.createdAt >= CODE_TASK_TTL_MS) {
      this.records.delete(taskId);
      return null;
    }
    return record;
  }

  async put(taskId: string, record: CodeTaskRecord): Promise<void> {
    const current = this.records.get(taskId);
    if (current && current.status !== "working") return;
    this.records.delete(taskId);
    this.records.set(taskId, record);
    // The oldest task goes first.
    while (this.records.size > this.maxTasks) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }

  async claimCheck(taskId: string, nowMs: number, gapMs: number): Promise<boolean> {
    const record = this.records.get(taskId);
    if (!record || record.status !== "working" || nowMs - record.lastCheckAt < gapMs) return false;
    record.lastCheckAt = nowMs;
    return true;
  }
}

let processStore: MemoryCodeTaskStore | undefined;
let sharedStore: CodeTaskStore | null | undefined;

/**
 * The task store for a transport, or null when the server creates no tasks on it. stdio keeps
 * tasks in the process. The hosted server keeps them in the Redis database of
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, and creates no tasks without it.
 */
export function codeTaskStore(transport: ClientContext["transport"]): CodeTaskStore | null {
  if (transport === "stdio") return (processStore ??= new MemoryCodeTaskStore());
  if (sharedStore === undefined) sharedStore = redisCodeTaskStoreFromEnv();
  return sharedStore;
}

/** True when the request's `_meta` declares the Tasks extension (protocol 2026-07-28). */
export function clientDeclaresTasks(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== "object") return false;
  const capabilities = (envelope as Record<string, unknown>)[CLIENT_CAPABILITIES_KEY];
  if (!capabilities || typeof capabilities !== "object") return false;
  const extensions = (capabilities as Record<string, unknown>).extensions;
  if (!extensions || typeof extensions !== "object") return false;
  const tasks = (extensions as Record<string, unknown>)[TASKS_EXTENSION];
  return !!tasks && typeof tasks === "object";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url").slice(0, 22);
}

/**
 * Who may read a task: the user of an OAuth token (its `sub`, because the token itself changes
 * on refresh), else the API key, else any caller without a credential. This only stops a task ID
 * from working with another credential; the API checks what each credential may read.
 */
export function callerBinding(context: ClientContext): string {
  const credential = context.apiKey;
  if (!credential) return "anon";
  if (isJWT(credential)) {
    try {
      const { sub } = jose.decodeJwt(credential);
      if (typeof sub === "string" && sub) return `s:${sha256(sub)}`;
    } catch {
      // Not a JWT after all: bind to the credential itself.
    }
  }
  return `k:${sha256(credential)}`;
}

/** The poll interval for the API's `retryAfter`: never below it, and at least 30 seconds. */
export function pollSeconds(retryAfter: number): number {
  return Math.min(Math.max(Math.ceil(retryAfter), MIN_POLL_SECONDS), MAX_POLL_SECONDS);
}

/** The shortest time between two requests to the API for a task: never below its poll interval. */
export function checkGapMs(record: Pick<CodeTaskRecord, "pollSeconds">): number {
  return Math.max(record.pollSeconds, MIN_CHECK_GAP_SECONDS) * 1000;
}

/** What the agent reads when the call becomes a task and while the task works. */
export function workingMessage(message: string): string {
  return `${message} Context7 gives the result of this call when the index is done. Until then, do not call the code tools for this version again: continue with query-docs.`;
}

export function codeTaskView(taskId: string, record: CodeTaskRecord): CodeTaskView {
  return {
    taskId,
    status: record.status,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUpdatedAt: new Date(record.updatedAt).toISOString(),
    ttlMs: CODE_TASK_TTL_MS,
    pollIntervalMs: record.pollSeconds * 1000,
    ...(record.status === "working" ? { statusMessage: workingMessage(record.message) } : {}),
    ...(record.status === "completed" ? { result: record.result } : {}),
    ...(record.status === "failed" ? { error: record.error } : {}),
  };
}

/**
 * Creates the task for a code tool call that found the source being indexed. Null when the
 * transport has no task store: the tool then answers as it does without tasks.
 */
export async function createCodeTask(
  tool: CodeTool,
  request: CodeRequest,
  indexing: NonNullable<ContextResponse["indexing"]>,
  context: ClientContext,
  nowMs = Date.now()
): Promise<CodeTaskView | null> {
  const store = codeTaskStore(context.transport);
  if (!store) return null;
  const taskId = randomBytes(16).toString("base64url");
  const record: CodeTaskRecord = {
    tool,
    request,
    createdAt: nowMs,
    updatedAt: nowMs,
    caller: callerBinding(context),
    pollSeconds: pollSeconds(indexing.retryAfter),
    lastCheckAt: nowMs,
    status: "working",
    message: indexing.message.slice(0, MAX_STATUS_MESSAGE_LENGTH),
  };
  // The Tasks extension requires the task to exist before the answer is sent. When the store
  // fails, the tool answers without a task.
  try {
    await store.put(taskId, record);
  } catch (error) {
    console.error("Could not store the code task:", error);
    return null;
  }
  return codeTaskView(taskId, record);
}

/**
 * The task of this caller, with its store. Null for an unknown ID and for a task of another
 * caller: both look the same to the client.
 */
export async function findCodeTask(
  taskId: string,
  context: ClientContext
): Promise<{ store: CodeTaskStore; record: CodeTaskRecord } | null> {
  const store = codeTaskStore(context.transport);
  if (!store || taskId.length > MAX_TASK_ID_LENGTH) return null;
  const record = await store.get(taskId);
  if (!record || record.caller !== callerBinding(context)) return null;
  return { store, record };
}

/** The JSON-RPC error of a task whose index was not ready after the 30 minute wait. */
export function expiredTaskError(tool: CodeTool): { code: number; message: string } {
  return {
    code: -32603,
    message: `The source index was not ready in 30 minutes, so this task ended without a result. Call ${tool} again if the source is still needed.`,
  };
}

/** For tests. */
export function resetCodeTasks(shared?: CodeTaskStore | null): void {
  processStore = undefined;
  sharedStore = shared;
}
