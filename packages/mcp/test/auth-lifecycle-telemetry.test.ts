import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  recordAuthenticationEvent: vi.fn(),
  recordToolCallOutcome: vi.fn(),
}));

vi.mock("../src/lib/telemetry-runtime.js", () => telemetry);

import {
  observeCredentialedInitialize,
  recordToolCallTelemetry,
} from "../src/lib/auth-lifecycle-telemetry.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("MCP authentication lifecycle telemetry", () => {
  test.each([
    [200, "credentialed_initialize_succeeded"],
    [500, "credentialed_initialize_failed"],
  ] as const)("records credentialed initialize completion for status %s", (statusCode, event) => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = statusCode;

    observeCredentialedInitialize(
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

    observeCredentialedInitialize(
      response,
      { method: "initialize" },
      {
        enforcementMode: "observe",
        method: "none",
        route: "anonymous",
      }
    );
    response.emit("finish");
    recordToolCallTelemetry(
      { apiKey: "oat_example", transport: "http", mcpEndpoint: "/mcp" },
      "error"
    );

    expect(telemetry.recordToolCallOutcome).toHaveBeenCalledWith("error");
    expect(telemetry.recordAuthenticationEvent).not.toHaveBeenCalled();
  });

  test("does not invent missing HTTP telemetry context", () => {
    recordToolCallTelemetry(
      { apiKey: "oat_example", transport: "http", mcpEndpoint: "/mcp" },
      "success"
    );

    expect(telemetry.recordToolCallOutcome).toHaveBeenCalledWith("success");
    expect(telemetry.recordAuthenticationEvent).not.toHaveBeenCalled();
  });

  test("records successful authenticated tool use", () => {
    recordToolCallTelemetry(
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
