import { beforeEach, describe, expect, test, vi } from "vitest";
import { validateEmaJWT, validateJWT } from "../src/lib/jwt.js";
import { validateMcpCredential, type HttpAuthPolicy } from "../src/lib/auth/http-auth.js";

vi.mock("../src/lib/jwt.js", () => ({
  isJWT: (token: string) => token.split(".").length === 3,
  validateEmaJWT: vi.fn(),
  validateJWT: vi.fn(),
}));

const metadataUrl = "https://mcp.context7.com/.well-known/oauth-protected-resource/mcp/ema";

function policy(kind: HttpAuthPolicy["kind"]): HttpAuthPolicy {
  return { kind, resourceMetadataUrl: metadataUrl };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateMcpCredential", () => {
  test("rejects opaque credentials for EMA", async () => {
    await expect(validateMcpCredential(policy("ema"), "ctx7-api-key")).resolves.toEqual({
      valid: false,
      error: "EMA access token required",
    });
    expect(validateEmaJWT).not.toHaveBeenCalled();
  });

  test("uses the strict EMA validator for JWT-shaped credentials", async () => {
    vi.mocked(validateEmaJWT).mockResolvedValue({ valid: true });

    await expect(validateMcpCredential(policy("ema"), "header.payload.signature")).resolves.toEqual(
      { valid: true }
    );
    expect(validateEmaJWT).toHaveBeenCalledWith("header.payload.signature");
    expect(validateJWT).not.toHaveBeenCalled();
  });

  test("preserves opaque API-key support for interactive OAuth", async () => {
    await expect(validateMcpCredential(policy("oauth"), "ctx7-api-key")).resolves.toEqual({
      valid: true,
    });
    expect(validateJWT).not.toHaveBeenCalled();
  });
});
