import type { Response } from "express";
import { classifyAuthMethod } from "./mcp-http-auth.js";
import { mcpRouteFromUrl, type McpHttpRoute } from "./mcp-route.js";
import type {
  AuthenticationEnforcementMode,
  AuthenticationMethod,
  AuthenticationOutcome,
} from "./telemetry-contracts.js";
import { recordAuthenticationEvent, recordToolCallOutcome } from "./telemetry-runtime.js";
import type { ToolCallOutcome } from "./tool-names.js";
import type { ClientContext } from "./types.js";

interface AuthEventContext {
  enforcementMode: AuthenticationEnforcementMode;
  method: AuthenticationMethod;
  outcome: AuthenticationOutcome;
  route: McpHttpRoute;
}

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

export function observeCredentialedInitialize(
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
          ? "credentialed_initialize_succeeded"
          : "credentialed_initialize_failed",
    });
  });
}

export function recordToolCallTelemetry(ctx: ClientContext, outcome: ToolCallOutcome): void {
  recordToolCallOutcome(outcome);
  if (
    ctx.transport !== "http" ||
    !ctx.apiKey ||
    !ctx.mcpAuthMode ||
    !ctx.mcpEndpoint ||
    outcome === "error"
  ) {
    return;
  }

  recordAuthenticationEvent({
    enforcementMode: ctx.mcpAuthMode,
    event: "authenticated_tool_call",
    method: classifyAuthMethod(ctx.apiKey),
    outcome: "accepted",
    route: mcpRouteFromUrl(ctx.mcpEndpoint),
  });
}
