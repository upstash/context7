import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/jwt.js", () => ({
  isJWT: (token: string) => token.split(".").length === 3,
  isClerkOAuthJwt: (token: string | undefined) => token?.startsWith("clerk.") ?? false,
  validateJWT: vi.fn(),
}));

vi.mock("../src/lib/oauth-token-validation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/oauth-token-validation.js")>()),
  validateOpaqueOAuthToken: vi.fn(),
}));

import { validateJWT } from "../src/lib/jwt.js";
import {
  rememberInvalidOAuthToken,
  resetOpaqueOAuthTokenValidation,
  validateOpaqueOAuthToken,
} from "../src/lib/oauth-token-validation.js";
import {
  classifyAuthMethod,
  effectiveMcpAuthMode,
  evaluateMcpAuthentication,
  parseMcpAuthMode,
} from "../src/lib/mcp-http-auth.js";

afterEach(() => {
  resetOpaqueOAuthTokenValidation();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("MCP HTTP authentication policy", () => {
  test("uses bounded authentication dimensions", () => {
    expect(classifyAuthMethod(undefined)).toBe("none");
    expect(classifyAuthMethod("oat_example")).toBe("oauth");
    expect(classifyAuthMethod("header.payload.signature")).toBe("jwt");
    expect(classifyAuthMethod("clerk.payload.signature")).toBe("oauth");
    expect(classifyAuthMethod("ctx7sk_example")).toBe("api_key");
  });

  test("defaults to enforcement and rejects unknown rollout modes", () => {
    vi.stubEnv("MCP_AUTH_ENFORCEMENT", "");
    expect(parseMcpAuthMode()).toBe("required");
    expect(() => parseMcpAuthMode("enforce-ish")).toThrow(/observe.*required/);
  });

  test("keeps the existing challenge for OAuth and plugin clients in observe mode", () => {
    expect(effectiveMcpAuthMode("observe", "/mcp", undefined, undefined)).toBe("observe");
    expect(effectiveMcpAuthMode("observe", "/mcp/oauth", undefined, undefined)).toBe("required");
    expect(effectiveMcpAuthMode("observe", "/mcp", "claude-code-plugin", undefined)).toBe(
      "required"
    );
    expect(effectiveMcpAuthMode("observe", "/mcp", "claude-code-plugin", "")).toBe("observe");
    expect(effectiveMcpAuthMode("required", "/mcp", "claude-code-plugin", "")).toBe("required");
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
      method: "api_key",
      event: "credential_present",
    });
  });

  test("challenges an expired opaque OAuth token in both modes", async () => {
    vi.mocked(validateOpaqueOAuthToken).mockResolvedValue("invalid");

    for (const mode of ["observe", "required"] as const) {
      await expect(evaluateMcpAuthentication("oat_expired", mode)).resolves.toEqual({
        allowed: false,
        method: "oauth",
        error: "The access token expired or is invalid",
        event: "credential_rejected",
        outcome: "expired",
      });
    }
    expect(validateOpaqueOAuthToken).toHaveBeenCalledWith("oat_expired");
  });

  test("passes a valid opaque OAuth token through and fails open when unchecked", async () => {
    vi.mocked(validateOpaqueOAuthToken)
      .mockResolvedValueOnce("valid")
      .mockResolvedValueOnce("unavailable");

    await expect(evaluateMcpAuthentication("oat_valid", "required")).resolves.toMatchObject({
      allowed: true,
      method: "oauth",
      event: "credential_validated",
      outcome: "accepted",
    });
    await expect(evaluateMcpAuthentication("oat_outage", "required")).resolves.toMatchObject({
      allowed: true,
      method: "oauth",
      event: "credential_present",
      outcome: "unverified",
    });
  });

  test("skips the opaque OAuth token check when validation is switched off", async () => {
    vi.stubEnv("MCP_OAUTH_TOKEN_VALIDATION", "off");

    await expect(evaluateMcpAuthentication("oat_expired", "required")).resolves.toMatchObject({
      allowed: true,
      method: "oauth",
      event: "credential_present",
      outcome: "accepted",
    });
    expect(validateOpaqueOAuthToken).not.toHaveBeenCalled();
  });

  test("leaves API keys to the Context7 API", async () => {
    await expect(evaluateMcpAuthentication("ctx7sk-invalid", "required")).resolves.toMatchObject({
      allowed: true,
      method: "api_key",
      event: "credential_present",
      outcome: "accepted",
    });
    expect(validateOpaqueOAuthToken).not.toHaveBeenCalled();
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
      outcome: "invalid",
    });
  });

  test("reports an expired Clerk OAuth JWT like an expired opaque token", async () => {
    vi.mocked(validateJWT).mockResolvedValueOnce({ valid: false, error: "Token expired" });

    await expect(evaluateMcpAuthentication("clerk.payload.signature", "observe")).resolves.toEqual({
      allowed: false,
      method: "oauth",
      error: "Token expired",
      event: "credential_rejected",
      outcome: "expired",
    });
    expect(validateOpaqueOAuthToken).not.toHaveBeenCalled();
  });

  test("logs a validation warning without the token and still admits the request", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(validateJWT).mockResolvedValueOnce({
      valid: true,
      warning: "audienceMismatch clientId=client_1 aud=https://other.example enforcement=observe",
    });

    await expect(evaluateMcpAuthentication("clerk.payload.signature", "required")).resolves.toEqual(
      {
        allowed: true,
        method: "oauth",
        event: "credential_validated",
        outcome: "accepted",
      }
    );
    const logged = consoleError.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("audienceMismatch clientId=client_1 aud=https://other.example");
    expect(logged).not.toContain("clerk.payload.signature");
  });

  test("challenges a Clerk OAuth JWT the Context7 API rejected earlier", async () => {
    rememberInvalidOAuthToken("clerk.payload.signature");

    await expect(evaluateMcpAuthentication("clerk.payload.signature", "observe")).resolves.toEqual({
      allowed: false,
      method: "oauth",
      error: "The access token expired or is invalid",
      event: "credential_rejected",
      outcome: "expired",
    });
    expect(validateJWT).not.toHaveBeenCalled();

    // Other JWTs are never looked up in the OAuth verdict cache.
    rememberInvalidOAuthToken("header.payload.signature");
    vi.mocked(validateJWT).mockResolvedValueOnce({ valid: true });
    await expect(
      evaluateMcpAuthentication("header.payload.signature", "observe")
    ).resolves.toMatchObject({ allowed: true, method: "jwt" });
  });
});
