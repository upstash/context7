import type { Response } from "express";
import { authenticationRoute, classifyAuthMethod } from "./mcp-http-auth.js";
import type { AuthenticationEventObservation } from "./telemetry-contracts.js";
import { recordAuthenticationEvent, recordToolCallOutcome } from "./telemetry-runtime.js";
import type { ToolCallOutcome } from "./tool-names.js";
import type { ClientContext } from "./types.js";

type AuthEventContext = Omit<AuthenticationEventObservation, "event">;

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
  if (context.method === "none" || !containsJsonRpcMethod(body, "initialize")) return;

  response.once("finish", () => {
    recordAuthenticationEvent({
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

  const endpoint = ctx.mcpEndpoint ?? "/mcp";
  recordAuthenticationEvent({
    enforcementMode: ctx.mcpAuthMode ?? "observe",
    event: "authenticated_tool_call",
    method: classifyAuthMethod(ctx.apiKey),
    outcome: "accepted",
    route: authenticationRoute(endpoint),
  });
}
