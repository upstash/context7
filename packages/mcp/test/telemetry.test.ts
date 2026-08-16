import { describe, expect, test } from "vitest";
import { getMcpMethod } from "../src/lib/telemetry.js";

describe("getMcpMethod", () => {
  test("prefers the modern MCP method header", () => {
    expect(getMcpMethod("tools/call", { method: "tools/list" })).toBe("tools/call");
  });

  test("falls back to a legacy JSON-RPC body", () => {
    expect(getMcpMethod(undefined, { jsonrpc: "2.0", method: "tools/list" })).toBe("tools/list");
  });

  test("uses bounded labels for batches and untrusted method names", () => {
    expect(getMcpMethod(undefined, [{ method: "tools/list" }])).toBe("batch");
    expect(getMcpMethod("attacker-controlled-method", {})).toBe("unknown");
    expect(getMcpMethod(undefined, null)).toBe("unknown");
  });
});
