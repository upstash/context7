import type { Response } from "express";
import { classifyAuthMethod, logMcpAuthEvent, type McpAuthEventInput } from "./auth-telemetry.js";
import { recordToolCallOutcome } from "./telemetry-runtime.js";
import type { ToolCallOutcome } from "./tool-names.js";
import type { ClientContext } from "./types.js";

type AuthEventContext = Omit<McpAuthEventInput, "event">;

function containsJsonRpcMethod(body: unknown, method: string): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      "method" in message &&
      message.method === method
  );
}

export function observeAuthenticatedInitialize(
  response: Pick<Response, "once" | "statusCode">,
  body: unknown,
  context: AuthEventContext
): void {
  if (context.authMethod === "none" || !containsJsonRpcMethod(body, "initialize")) return;

  response.once("finish", () => {
    logMcpAuthEvent({
      ...context,
      event:
        response.statusCode >= 200 && response.statusCode < 300
          ? "authenticated_initialize_succeeded"
          : "authenticated_initialize_failed",
    });
  });
}

export function recordAuthenticatedToolCall(ctx: ClientContext, outcome: ToolCallOutcome): void {
  recordToolCallOutcome(outcome);
  if (ctx.transport !== "http" || !ctx.apiKey || outcome === "error") return;

  logMcpAuthEvent({
    actorIp: ctx.clientIp,
    authMethod: classifyAuthMethod(ctx.apiKey),
    clientInfo: ctx.clientInfo,
    endpoint: ctx.mcpEndpoint ?? "/mcp",
    event: "authenticated_tool_call",
    plugin: ctx.plugin,
    rolloutMode: ctx.mcpAuthMode,
  });
}
