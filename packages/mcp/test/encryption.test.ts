import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createClientIpAssertion, generateHeaders } from "../src/lib/encryption.js";

const KEY = "0123456789abcdef".repeat(4);
const NOW_MS = 1_788_000_000_000;
const NONCE = Buffer.from("00112233445566778899aabb", "hex");

describe("client IP assertions", () => {
  beforeEach(() => {
    process.env.MCP_CLIENT_IP_ASSERTION_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.MCP_CLIENT_IP_ASSERTION_KEY;
  });

  test("creates a versioned AES-GCM assertion", () => {
    const value = createClientIpAssertion("203.0.113.99", NOW_MS, NONCE);

    expect(value).toBe(
      "v1:1788000000:00112233445566778899aabb:8f761fbf38cf8e7ea8dd992aab5e3db53b0f318adfe3d3207e8675d4"
    );
  });

  test("emits only the authenticated assertion header", () => {
    const headers = generateHeaders({ clientIp: "203.0.113.99" });

    expect(headers["mcp-client-ip-assertion"]).toMatch(/^v1:/);
    expect(headers["mcp-client-ip"]).toBeUndefined();
  });

  test("fails closed instead of sending plaintext when the key is absent or invalid", () => {
    delete process.env.MCP_CLIENT_IP_ASSERTION_KEY;
    expect(
      generateHeaders({ clientIp: "203.0.113.99" })["mcp-client-ip-assertion"]
    ).toBeUndefined();
    expect(generateHeaders({ clientIp: "203.0.113.99" })["mcp-client-ip"]).toBeUndefined();

    process.env.MCP_CLIENT_IP_ASSERTION_KEY = "not-a-key";
    expect(createClientIpAssertion("203.0.113.99", NOW_MS, NONCE)).toBeNull();
  });

  test.each(["999.999.999.999", "1:2:3", "attacker-selected-bucket"])(
    "refuses to sign an invalid IP address (%s)",
    (value) => {
      expect(createClientIpAssertion(value, NOW_MS, NONCE)).toBeNull();
    }
  );
});
