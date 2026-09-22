import { EventEmitter } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  observeAuthenticatedInitialize,
  recordAuthenticatedToolCall,
} from "../src/lib/auth-lifecycle-telemetry.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP authentication lifecycle telemetry", () => {
  test.each([
    [200, "authenticated_initialize_succeeded"],
    [500, "authenticated_initialize_failed"],
  ] as const)("records authenticated initialize completion for status %s", (statusCode, event) => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = statusCode;

    observeAuthenticatedInitialize(
      response,
      { jsonrpc: "2.0", method: "initialize", id: 1 },
      { authMethod: "oauth", endpoint: "/mcp", rolloutMode: "required" }
    );
    response.emit("finish");

    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ event });
  });

  test("ignores unauthenticated initialize and failed tool calls", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 200;

    observeAuthenticatedInitialize(
      response,
      { method: "initialize" },
      {
        authMethod: "none",
        endpoint: "/mcp",
      }
    );
    response.emit("finish");
    recordAuthenticatedToolCall(
      { apiKey: "oat_example", transport: "http", mcpEndpoint: "/mcp" },
      "error"
    );

    expect(output).not.toHaveBeenCalled();
  });

  test("records successful authenticated tool use", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    recordAuthenticatedToolCall(
      { apiKey: "oat_example", transport: "http", mcpEndpoint: "/mcp" },
      "success"
    );

    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
      authMethod: "oauth",
      event: "authenticated_tool_call",
    });
  });
});
