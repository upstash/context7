import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/jwt.js", () => ({
  isJWT: (token: string) => token.split(".").length === 3,
  validateJWT: vi.fn(),
}));

import { validateJWT } from "../src/lib/jwt.js";
import {
  authenticationRoute,
  classifyAuthMethod,
  evaluateMcpAuthentication,
  parseMcpAuthMode,
} from "../src/lib/mcp-http-auth.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("MCP HTTP authentication policy", () => {
  test("uses bounded authentication dimensions", () => {
    expect(classifyAuthMethod(undefined)).toBe("none");
    expect(classifyAuthMethod("oat_example")).toBe("oauth");
    expect(classifyAuthMethod("header.payload.signature")).toBe("jwt");
    expect(classifyAuthMethod("ctx7sk_example")).toBe("api_key");
    expect(authenticationRoute("/mcp")).toBe("anonymous");
    expect(authenticationRoute("/mcp/oauth")).toBe("oauth");
  });

  test("defaults to observation and rejects unknown rollout modes", () => {
    vi.stubEnv("MCP_AUTH_ENFORCEMENT", "");
    expect(parseMcpAuthMode()).toBe("observe");
    expect(() => parseMcpAuthMode("enforce-ish")).toThrow(/observe.*required/);
  });

  test("separates observation from enforcement for missing credentials", async () => {
    await expect(evaluateMcpAuthentication(undefined, "observe")).resolves.toMatchObject({
      allowed: true,
      event: "credential_missing",
      outcome: "missing",
    });
    await expect(evaluateMcpAuthentication(undefined, "required")).resolves.toMatchObject({
      allowed: false,
      event: "challenge_issued",
      outcome: "missing",
    });
  });

  test("records opaque credentials as present until the API validates them", async () => {
    await expect(evaluateMcpAuthentication("ctx7sk-example", "required")).resolves.toMatchObject({
      allowed: true,
      authMethod: "api_key",
      event: "credential_present",
    });
  });

  test("distinguishes validated and rejected JWTs", async () => {
    vi.mocked(validateJWT).mockResolvedValueOnce({ valid: true }).mockResolvedValueOnce({
      valid: false,
      error: "Token expired",
    });

    await expect(
      evaluateMcpAuthentication("header.payload.signature", "required")
    ).resolves.toMatchObject({
      allowed: true,
      event: "credential_validated",
    });
    await expect(
      evaluateMcpAuthentication("header.payload.signature", "required")
    ).resolves.toMatchObject({
      allowed: false,
      error: "Token expired",
      event: "credential_rejected",
    });
  });
});
