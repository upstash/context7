import { afterEach, describe, expect, test, vi } from "vitest";
import { classifyAuthMethod, logMcpAuthEvent } from "../src/lib/auth-telemetry.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MCP auth telemetry", () => {
  test.each([
    [undefined, "none"],
    ["oat_example", "oauth"],
    ["header.payload.signature", "jwt"],
    ["ctx7sk_example", "api_key"],
  ] as const)("classifies %s as %s", (token, expected) => {
    expect(classifyAuthMethod(token)).toBe(expected);
  });

  test("logs a stable actor without exposing IPs, credentials, or the full user agent", () => {
    vi.stubEnv("USAGE_ANONYMIZATION_SECRET", "local-test-secret");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logMcpAuthEvent({
      actorIp: "203.0.113.9",
      authMethod: "oauth",
      endpoint: "/mcp",
      event: "credential_accepted",
      plugin: "test-plugin",
      userAgent: "test-client/1.2.3 secret-fragment",
    });

    const serialized = String(output.mock.calls[0][0]);
    const event = JSON.parse(serialized) as Record<string, unknown>;
    expect(event).toMatchObject({
      message: "mcp_auth_event",
      event: "credential_accepted",
      endpoint: "/mcp",
      authMethod: "oauth",
      actorId: expect.stringMatching(/^anon_[a-f0-9]{24}$/),
      clientIde: "test-client",
      clientVersion: "1.2.3",
      plugin: "test-plugin",
    });
    expect(serialized).not.toContain("203.0.113.9");
    expect(serialized).not.toContain("secret-fragment");
    expect(serialized).not.toContain("oat_");
  });
});
