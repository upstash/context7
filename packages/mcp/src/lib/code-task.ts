import {
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { fetchCodeTask, indexingAnswer, type CodeTaskAnswer } from "./api.js";
import { recordToolCallOutcome } from "./telemetry-runtime.js";
import { CODE_TOOL_NAMES, type CodeTool } from "./tool-names.js";
import type { ClientContext, ContextResponse } from "./types.js";

// MCP tasks for the code tools (the Tasks extension, SEP-2663). When a code tool call finds the
// source still being indexed and the client declared the extension, the call answers with a task.
// The client polls tasks/get, and the agent gets the real result when the index is done.
//
// The Context7 API keeps the task: the tool call asks /v2/code for one (`task=1`), and tasks/get
// polls /v2/code/tasks/{id} with the credential of the poll, which replays the request for the
// caller that made it. This server keeps no state, so any replica answers any poll. The task ID
// is `<tool>.<API task ID>`: the tool names the answers' advice.

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

/** How long a task waits for the index. After it, the task ends with the "being indexed" answer. */
export const CODE_TASK_WAIT_MS = 30 * 60 * 1000;
/** How long the API keeps a task (CODE_TASK_TTL_SECONDS in the app), sent as `ttlMs`. */
export const CODE_TASK_TTL_MS = 90 * 60 * 1000;
/** The shortest poll interval. Claude Code polls at most every 30 seconds, whatever it is told. */
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 300;
/** The longest task ID a request may name (Claude Code accepts at most 128 characters). */
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

/** Turns a /v2/code answer into the tool result (code-tools.ts). */
type ToolResult = (response: ContextResponse) => CallToolResult;

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

/** The poll interval for the API's `retryAfter`: never below it, and at least 30 seconds. */
export function pollSeconds(retryAfter: number | undefined): number {
  return Math.min(Math.max(Math.ceil(retryAfter ?? 0), MIN_POLL_SECONDS), MAX_POLL_SECONDS);
}

/** The task ID for a tool and the API's task. */
export function codeTaskId(tool: CodeTool, apiTaskId: string): string {
  return `${tool}.${apiTaskId}`;
}

function parseCodeTaskId(taskId: string): { tool: CodeTool; apiTaskId: string } | null {
  const dot = taskId.indexOf(".");
  const tool = taskId.slice(0, dot) as CodeTool;
  const apiTaskId = taskId.slice(dot + 1);
  if (dot < 1 || !CODE_TOOL_NAMES.includes(tool) || !/^[A-Za-z0-9_-]+$/.test(apiTaskId))
    return null;
  return { tool, apiTaskId };
}

function view(
  taskId: string,
  status: CodeTaskStatus,
  createdAt: number,
  nowMs: number,
  fields: { message?: string; retryAfter?: number; result?: unknown } = {}
): CodeTaskView {
  return {
    taskId,
    status,
    createdAt: new Date(createdAt).toISOString(),
    lastUpdatedAt: new Date(nowMs).toISOString(),
    ttlMs: CODE_TASK_TTL_MS,
    pollIntervalMs: pollSeconds(fields.retryAfter) * 1000,
    ...(status === "working"
      ? {
          statusMessage: `${(fields.message ?? "The library source is being indexed.").slice(0, MAX_STATUS_MESSAGE_LENGTH)} Context7 gives the result of this call when the index is done. Until then, do not call the code tools for this version again: continue with query-docs.`,
        }
      : {}),
    ...(status === "completed" ? { result: fields.result } : {}),
  };
}

/**
 * The task for a tool call whose 202 named an API task (`indexing.taskId`), or null when it named
 * none (an API without tasks): the tool then answers as it does without tasks.
 */
export function createCodeTask(
  tool: CodeTool,
  indexing: NonNullable<ContextResponse["indexing"]>,
  nowMs = Date.now()
): CodeTaskView | null {
  if (!indexing.taskId) return null;
  const taskId = codeTaskId(tool, indexing.taskId);
  if (taskId.length > MAX_TASK_ID_LENGTH) return null;
  return view(taskId, "working", nowMs, nowMs, indexing);
}

const unknownTask = () => new ProtocolError(ProtocolErrorCode.InvalidParams, "Unknown task");

/**
 * The state of a code tool task for tasks/get, from the API's answer for it now. A timeout or a
 * gateway error keeps it working. After the 30-minute wait, an index still being built ends it
 * with the "being indexed" answer the call gives without a task. The tasks/get that first sees a
 * final answer marks its outcome on its own MCP operation (the tools/call was recorded with the
 * "being indexed" outcome).
 */
export async function getCodeTask(
  taskId: string,
  ctx: ClientContext,
  toResult: ToolResult,
  nowMs = Date.now()
): Promise<CodeTaskView> {
  const id = parseCodeTaskId(taskId);
  if (!id) throw unknownTask();
  const answer: CodeTaskAnswer = await fetchCodeTask(id.apiTaskId, ctx, id.tool);
  if (answer.ended === "unknown") throw unknownTask();
  const createdAt = answer.createdAt ?? nowMs;
  if (answer.ended === "cancelled") return view(taskId, "cancelled", createdAt, nowMs);

  const pending = !!answer.indexing || !!answer.transient;
  const waiting = nowMs - createdAt < CODE_TASK_WAIT_MS;
  if (pending && waiting) return view(taskId, "working", createdAt, nowMs, answer.indexing);
  const response: ContextResponse = pending
    ? { data: indexingAnswer(answer.indexing?.message, id.tool), outcome: "not_found" }
    : answer;
  if (!answer.stored) recordToolCallOutcome(response.outcome);
  return view(taskId, "completed", createdAt, nowMs, { result: toResult(response) });
}

/**
 * tasks/cancel: the API stops answering the task (later polls answer `cancelled`). The index is
 * not stopped, because the next call for the version uses it.
 */
export async function cancelCodeTask(taskId: string, ctx: ClientContext): Promise<void> {
  const id = parseCodeTaskId(taskId);
  if (!id) throw unknownTask();
  const answer = await fetchCodeTask(id.apiTaskId, ctx, id.tool, "DELETE");
  if (answer.ended === "unknown") throw unknownTask();
}

const taskParams = z.object({ taskId: z.string().min(1).max(MAX_TASK_ID_LENGTH) }).loose();

/**
 * Registers tasks/get, tasks/cancel and tasks/update. They answer only a request that declares
 * the Tasks extension (-32021).
 */
export function registerCodeTaskHandlers(
  server: McpServer,
  getClientContext: (toolCtx: ServerContext) => ClientContext,
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
    getCodeTask(taskId, context(toolCtx), toResult)
  );
  server.server.setRequestHandler(
    "tasks/cancel",
    { params: taskParams },
    async ({ taskId }, toolCtx) => {
      await cancelCodeTask(taskId, context(toolCtx));
      return {};
    }
  );
  // No task asks the client for input, so there is nothing to update.
  server.server.setRequestHandler(
    "tasks/update",
    { params: taskParams },
    async ({ taskId }, toolCtx) => {
      context(toolCtx);
      if (!parseCodeTaskId(taskId)) throw unknownTask();
      return {};
    }
  );
}
