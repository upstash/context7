import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  recordAuthenticationEvent: vi.fn(),
  recordToolCallOutcome: vi.fn(),
}));

vi.mock("../src/lib/telemetry-runtime.js", () => telemetry);

import {
  observeAuthenticatedInitialize,
  recordAuthenticatedToolCall,
} from "../src/lib/auth-lifecycle-telemetry.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("MCP authentication lifecycle telemetry", () => {
  test.each([
    [200, "authenticated_initialize_succeeded"],
    [500, "authenticated_initialize_failed"],
  ] as const)("records authenticated initialize completion for status %s", (statusCode, event) => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = statusCode;

    observeAuthenticatedInitialize(
      response,
      { jsonrpc: "2.0", method: "initialize", id: 1 },
      {
        enforcementMode: "required",
        method: "oauth",
        outcome: "accepted",
        route: "anonymous",
      }
    );
    response.emit("finish");

    expect(telemetry.recordAuthenticationEvent).toHaveBeenCalledWith({
      enforcementMode: "required",
      event,
      method: "oauth",
      outcome: "accepted",
      route: "anonymous",
    });
  });

  test("ignores unauthenticated initialize and failed tool calls", () => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 200;

    observeAuthenticatedInitialize(
      response,
      { method: "initialize" },
      {
        enforcementMode: "observe",
        method: "none",
        route: "anonymous",
      }
    );
    response.emit("finish");
    recordAuthenticatedToolCall(
      { apiKey: "oat_example", transport: "http", mcpEndpoint: "/mcp" },
      "error"
    );

    expect(telemetry.recordToolCallOutcome).toHaveBeenCalledWith("error");
    expect(telemetry.recordAuthenticationEvent).not.toHaveBeenCalled();
  });

  test("records successful authenticated tool use", () => {
    recordAuthenticatedToolCall(
      {
        apiKey: "oat_example",
        transport: "http",
        mcpAuthMode: "required",
        mcpEndpoint: "/mcp",
      },
      "success"
    );

    expect(telemetry.recordAuthenticationEvent).toHaveBeenCalledWith({
      enforcementMode: "required",
      event: "authenticated_tool_call",
      method: "oauth",
      outcome: "accepted",
      route: "anonymous",
    });
  });
});
