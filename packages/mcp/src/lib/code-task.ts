import { createHash, randomBytes } from "node:crypto";
import {
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { codeVersion, fetchLibraryCode, indexingAnswer } from "./api.js";
import { credentialOwner } from "./credential-owner.js";
import { recordToolCallOutcome } from "./telemetry-runtime.js";
import type { CodeTool } from "./tool-names.js";
import type { ClientContext, CodeRequest, ContextResponse } from "./types.js";

// MCP tasks for the code tools (the Tasks extension, SEP-2663). When a code tool call finds the
// source still being indexed and the client declared the extension, the call answers with a task.
// The client polls tasks/get, and the agent gets the real result when the index is done.
//
// A task is a record in a CodeTaskStore under a random ID: in memory for stdio, in Upstash Redis
// for the hosted server, whose pods share it (code-task-redis.ts). tasks/get sends the stored
// request to the API again with the credential of the tasks/get call, so the API decides what that
// caller may read.

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

/** How long a task waits for the index. After it, the task ends with the "being indexed" answer. */
export const CODE_TASK_WAIT_MS = 30 * 60 * 1000;
/**
 * How long a store keeps a task, counted from its creation, and the `ttlMs` sent to clients: the
 * wait plus an hour, so a session resumed within the hour still gets the result.
 */
export const CODE_TASK_TTL_MS = CODE_TASK_WAIT_MS + 60 * 60 * 1000;
/** The shortest poll interval. Claude Code polls at most every 30 seconds, whatever it is told. */
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 300;
/**
 * The shortest time between two API requests for one caller and library version. The API's poll
 * pass gives 15 free requests in 10 minutes for that pair; this gap makes at most 14.
 */
const MIN_CHECK_GAP_SECONDS = 45;
/** The longest task ID a request may name (the IDs this server makes have 22 characters). */
export const MAX_TASK_ID_LENGTH = 128;
const MAX_STATUS_MESSAGE_LENGTH = 300;

type CodeTaskStatus = "working" | "completed" | "cancelled";

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
};

/** What a store keeps for a task. */
export interface CodeTaskRecord {
  tool: CodeTool;
  /** The request to /v2/code. */
  request: CodeRequest;
  /** Unix milliseconds. */
  createdAt: number;
  updatedAt: number;
  /** The caller (see callerBinding). */
  caller: string;
  /** The poll interval, from the API's latest `retryAfter`. */
  pollSeconds: number;
  status: CodeTaskStatus;
  /** The API's latest "being indexed" message. */
  message: string;
  /** The tool result of a completed task. */
  result?: unknown;
}

/**
 * Where tasks live. The hosted server's store is shared by all its pods, because a tasks/get can
 * reach any of them. Every write is checked against the stored state, so pods cannot race.
 */
export interface CodeTaskStore {
  get(taskId: string, nowMs: number): Promise<CodeTaskRecord | null>;
  /**
   * Writes the record, kept until CODE_TASK_TTL_MS after its creation. A task that has ended is
   * not written again (the first final status wins): then false.
   */
  put(taskId: string, record: CodeTaskRecord): Promise<boolean>;
  /**
   * The gate for API requests of one caller and library version (see checkGate). True, and the
   * gate set to `nowMs`, when the last request through it is at least `gapMs` old.
   */
  claimCheck(gate: string, nowMs: number, gapMs: number): Promise<boolean>;
  /** Opens the gate: the index is done, so the other tasks of the version may ask at once. */
  releaseCheck(gate: string): Promise<void>;
}

/** Drops the oldest entry (the first inserted) of a map that has grown past `max`. */
function trimOldest(map: Map<string, unknown>, max: number): void {
  const oldest = map.size > max ? map.keys().next().value : undefined;
  if (oldest !== undefined) map.delete(oldest);
}

/** Tasks in this process: right for stdio, where one process serves one client. */
export class MemoryCodeTaskStore implements CodeTaskStore {
  private readonly records = new Map<string, CodeTaskRecord>();
  private readonly gates = new Map<string, number>();

  constructor(private readonly maxTasks = 1000) {}

  async get(taskId: string, nowMs: number): Promise<CodeTaskRecord | null> {
    const record = this.records.get(taskId);
    if (!record || nowMs - record.createdAt < CODE_TASK_TTL_MS) return record ?? null;
    this.records.delete(taskId);
    return null;
  }

  async put(taskId: string, record: CodeTaskRecord): Promise<boolean> {
    const current = this.records.get(taskId);
    if (current && current.status !== "working") return false;
    this.records.delete(taskId);
    this.records.set(taskId, record);
    trimOldest(this.records, this.maxTasks);
    return true;
  }

  async claimCheck(gate: string, nowMs: number, gapMs: number): Promise<boolean> {
    const last = this.gates.get(gate);
    if (last !== undefined && nowMs - last < gapMs) return false;
    this.gates.delete(gate);
    this.gates.set(gate, nowMs);
    trimOldest(this.gates, this.maxTasks);
    return true;
  }

  async releaseCheck(gate: string): Promise<void> {
    this.gates.delete(gate);
  }
}

/**
 * True when the request may get a task: a 2026-07-28 request whose `_meta` declares the Tasks
 * extension. A 2025-era request never gets one, whatever its `_meta` holds.
 */
export function clientDeclaresTasks(envelope: unknown): boolean {
  if (!envelope || typeof envelope !== "object") return false;
  const meta = envelope as Record<string, unknown>;
  const version = meta[PROTOCOL_VERSION_KEY];
  if (typeof version !== "string" || version < "2026-07-28") return false;
  const capabilities = meta[CLIENT_CAPABILITIES_KEY];
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
 * Who may read a task: the Context7 user of a verified OAuth token (a refreshed token is the same
 * user), else the credential itself, else any caller without one. A stored result is answered
 * without a call to the API, so only a verified owner may stand for a credential.
 */
export function callerBinding(context: ClientContext): string {
  const credential = context.apiKey;
  if (!credential) return "anon";
  const owner = credentialOwner(credential);
  return owner && "userId" in owner ? `u:${sha256(owner.userId)}` : `k:${sha256(credential)}`;
}

/**
 * The gate of a task's API requests: its caller and library version, as the API's poll pass
 * counts them. Parallel tasks for one version (a grep and a glob) share it.
 */
export function checkGate(record: Pick<CodeTaskRecord, "caller" | "request">): string {
  // The version as the API reads it: from `version` (without a copied library ID prefix), else
  // from a versioned library ID ("/org/project/v1.2.3"); none and "latest" are the same.
  const [owner, project, ...inId] = record.request.libraryId
    .trim()
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  let version = codeVersion(record.request)?.trim() || inId.join("/");
  if (version === "latest") version = "";
  return sha256(`${record.caller}|/${owner}/${project}|${version}`);
}

/** The poll interval for the API's `retryAfter`: never below it, and at least 30 seconds. */
export function pollSeconds(retryAfter: number | undefined): number {
  return Math.min(Math.max(Math.ceil(retryAfter ?? 0), MIN_POLL_SECONDS), MAX_POLL_SECONDS);
}

/** The shortest time between two API requests through a task's gate: never below its interval. */
export function checkGapMs(record: Pick<CodeTaskRecord, "pollSeconds">): number {
  return Math.max(record.pollSeconds, MIN_CHECK_GAP_SECONDS) * 1000;
}

export function codeTaskView(taskId: string, record: CodeTaskRecord): CodeTaskView {
  return {
    taskId,
    status: record.status,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUpdatedAt: new Date(record.updatedAt).toISOString(),
    ttlMs: CODE_TASK_TTL_MS,
    pollIntervalMs: record.pollSeconds * 1000,
    ...(record.status === "working"
      ? {
          statusMessage: `${record.message.slice(0, MAX_STATUS_MESSAGE_LENGTH)} Context7 gives the result of this call when the index is done. Until then, do not call the code tools for this version again: continue with query-docs.`,
        }
      : {}),
    ...(record.status === "completed" ? { result: record.result } : {}),
  };
}

/**
 * Creates and stores the task for a code tool call that found the source being indexed. Null
 * when the store fails: the tool then answers as it does without tasks.
 */
export async function createCodeTask(
  store: CodeTaskStore,
  tool: CodeTool,
  request: CodeRequest,
  indexing: { retryAfter?: number; message: string },
  context: ClientContext,
  nowMs = Date.now()
): Promise<CodeTaskView | null> {
  const taskId = randomBytes(16).toString("base64url");
  const record: CodeTaskRecord = {
    tool,
    request,
    createdAt: nowMs,
    updatedAt: nowMs,
    caller: callerBinding(context),
    pollSeconds: pollSeconds(indexing.retryAfter),
    status: "working",
    message: indexing.message,
  };
  try {
    // The Tasks extension requires the task to exist before the answer is sent. The tool call
    // itself was a request through the task's gate.
    await store.put(taskId, record);
    await store.claimCheck(checkGate(record), nowMs, 0);
  } catch (error) {
    console.error("Could not store the code task:", error);
    return null;
  }
  return codeTaskView(taskId, record);
}

/** The task of this caller. Null for an unknown ID and for a task of another caller alike. */
export async function findCodeTask(
  store: CodeTaskStore,
  taskId: string,
  context: ClientContext,
  nowMs = Date.now()
): Promise<CodeTaskRecord | null> {
  const record = await store.get(taskId, nowMs);
  return record && record.caller === callerBinding(context) ? record : null;
}

/** The task of this caller, or the -32602 "Unknown task" error the tasks/* methods answer. */
async function requireCodeTask(
  store: CodeTaskStore,
  taskId: string,
  context: ClientContext,
  nowMs: number
): Promise<CodeTaskRecord> {
  const record = await findCodeTask(store, taskId, context, nowMs);
  if (!record) throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown task");
  return record;
}

/** Turns a /v2/code answer into the tool result (code-tools.ts). */
type ToolResult = (response: ContextResponse) => CallToolResult;

/**
 * The state of a code tool task for tasks/get. A working task asks the API again only when its
 * gate (one per caller and library version) lets it; any other poll answers `working` at once. An
 * ended task answers from its record, so it costs no request. The tools/call was recorded with
 * the "being indexed" outcome; the tasks/get that completes the task marks the result's outcome
 * on its own MCP operation.
 */
export async function getCodeTask(
  store: CodeTaskStore,
  taskId: string,
  ctx: ClientContext,
  toResult: ToolResult,
  nowMs = Date.now()
): Promise<CodeTaskView> {
  const record = await requireCodeTask(store, taskId, ctx, nowMs);
  const gate = checkGate(record);
  if (record.status !== "working" || !(await store.claimCheck(gate, nowMs, checkGapMs(record))))
    return codeTaskView(taskId, record);

  let response = await fetchLibraryCode(record.request, ctx, record.tool);
  const waiting = nowMs - record.createdAt < CODE_TASK_WAIT_MS;
  const indexDone = !response.transient && !response.indexing;
  if (response.transient) {
    // A timeout or a gateway error says nothing about the index: the task waits on, and after
    // the wait it ends with the "being indexed" answer it last had.
    if (waiting) return codeTaskView(taskId, record);
    response = { data: indexingAnswer(record.message, record.tool), outcome: "not_found" };
  }

  const next = { ...record, updatedAt: nowMs };
  if (response.indexing && waiting) {
    next.pollSeconds = pollSeconds(response.indexing.retryAfter);
    next.message = response.indexing.message;
  } else {
    // The result, or after the wait the "being indexed" answer the call gives without a task.
    next.status = "completed";
    next.result = toResult(response);
    // The index is done: the other tasks of the version may ask at their next poll.
    if (indexDone) await store.releaseCheck(gate);
  }
  if (await store.put(taskId, next)) {
    // The outcome only: the tools/call already sent this caller's tool call event.
    if (next.status === "completed") recordToolCallOutcome(response.outcome);
    return codeTaskView(taskId, next);
  }
  // The task ended meanwhile (a cancel won): answer what is stored.
  return codeTaskView(taskId, (await store.get(taskId, nowMs)) ?? next);
}

/**
 * tasks/cancel: a working task ends as `cancelled`. The index is not stopped, because the next
 * call for the version uses it. Cancelling an ended task changes nothing.
 */
export async function cancelCodeTask(
  store: CodeTaskStore,
  taskId: string,
  ctx: ClientContext,
  nowMs = Date.now()
): Promise<void> {
  const record = await requireCodeTask(store, taskId, ctx, nowMs);
  if (record.status === "working")
    await store.put(taskId, { ...record, status: "cancelled", updatedAt: nowMs });
}

const taskParams = z.object({ taskId: z.string().min(1).max(MAX_TASK_ID_LENGTH) }).loose();

/**
 * Registers tasks/get, tasks/cancel and tasks/update. They answer only a request that declares
 * the Tasks extension (-32021).
 */
export function registerCodeTaskHandlers(
  server: McpServer,
  getClientContext: (toolCtx: ServerContext) => ClientContext,
  store: CodeTaskStore,
  toResult: ToolResult
): void {
  const context = (toolCtx: ServerContext): ClientContext => {
    if (!clientDeclaresTasks(toolCtx.mcpReq.envelope))
      throw new MissingRequiredClientCapabilityError({
        requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } },
      });
    return getClientContext(toolCtx);
  };
  server.server.setRequestHandler("tasks/get", { params: taskParams }, ({ taskId }, toolCtx) =>
    getCodeTask(store, taskId, context(toolCtx), toResult)
  );
  server.server.setRequestHandler(
    "tasks/cancel",
    { params: taskParams },
    async ({ taskId }, toolCtx) => {
      await cancelCodeTask(store, taskId, context(toolCtx));
      return {};
    }
  );
  // No task asks the client for input, so there is nothing to update.
  server.server.setRequestHandler(
    "tasks/update",
    { params: taskParams },
    async ({ taskId }, toolCtx) => {
      await requireCodeTask(store, taskId, context(toolCtx), Date.now());
      return {};
    }
  );
}
