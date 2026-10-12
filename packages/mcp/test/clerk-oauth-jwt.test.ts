/**
 * End-to-end checks of the Clerk OAuth JWT branch: real `jose` verification
 * against a key generated for the test run, with the remote JWKS replaced by
 * a local key set so nothing touches the network.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import * as jose from "jose";
import type { Response as ExpressResponse } from "express";

const keys = vi.hoisted(() => ({
  jwks: undefined as ReturnType<typeof jose.createLocalJWKSet> | undefined,
  remoteJwksUrls: [] as string[],
}));

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof jose>("jose");
  return {
    ...actual,
    createRemoteJWKSet: (url: URL) => {
      keys.remoteJwksUrls.push(url.toString());
      const resolver = (
        header: jose.JWSHeaderParameters,
        token: jose.FlattenedJWSInput
      ): Promise<jose.CryptoKey> => {
        if (!keys.jwks) throw new Error("JWKS not initialised");
        return keys.jwks(header, token);
      };
      return resolver as unknown as ReturnType<typeof actual.createRemoteJWKSet>;
    },
  };
});

import { isClerkOAuthJwt, validateJWT } from "../src/lib/jwt.js";
import {
  classifyAuthMethod,
  evaluateMcpAuthentication,
  resetJwtWarningLog,
  setBearerChallenge,
} from "../src/lib/mcp-http-auth.js";
import {
  rememberInvalidOAuthToken,
  resetOpaqueOAuthTokenValidation,
} from "../src/lib/oauth-token-validation.js";
import { searchLibraries } from "../src/lib/api.js";

const ISSUER = "https://clerk.context7.com";
const AUDIENCE = "https://mcp.context7.com/mcp";
const CLIENT_ID = "client_2abcDEF";
const KID = "ins_test_key";

let privateKey: jose.CryptoKey;
let strangerKey: jose.CryptoKey;
const fetchMock = vi.fn<typeof fetch>();

interface TokenOptions {
  typ?: string | null;
  iss?: string;
  aud?: string | string[] | null;
  expiresIn?: number;
  key?: jose.CryptoKey;
  claims?: jose.JWTPayload;
}

async function sign({
  typ = "at+jwt",
  iss = ISSUER,
  aud = AUDIENCE,
  expiresIn = 3600,
  key = privateKey,
  claims = { client_id: CLIENT_ID },
}: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: jose.JWTPayload = {
    iss,
    sub: "user_123",
    iat: now - 5,
    exp: now + expiresIn,
    jti: "jti_123",
    ...claims,
  };
  if (aud !== null) payload.aud = aud;
  const header: jose.JWTHeaderParameters = { alg: "RS256", kid: KID };
  if (typ !== null) header.typ = typ;
  return new jose.SignJWT(payload).setProtectedHeader(header).sign(key);
}

/** The shape Clerk gives a session JWT: `typ: JWT`, no `aud`, session claims. */
function sessionJwt(): Promise<string> {
  return sign({ typ: "JWT", aud: null, claims: { sid: "sess_123", azp: "https://context7.com" } });
}

/** The shape of an OIDC ID token: `typ: JWT`, addressed to the OAuth client. */
function idToken(): Promise<string> {
  return sign({ typ: "JWT", aud: CLIENT_ID, claims: { nonce: "n", email: "u@example.com" } });
}

function challenge(error?: string): string {
  let header = "";
  const res = { set: (_name: string, value: string) => (header = value) } as ExpressResponse;
  setBearerChallenge(res, "/mcp", error);
  return header;
}

beforeAll(async () => {
  const pair = await jose.generateKeyPair("RS256");
  privateKey = pair.privateKey;
  strangerKey = (await jose.generateKeyPair("RS256")).privateKey;
  const jwk = await jose.exportJWK(pair.publicKey);
  keys.jwks = jose.createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });
});

beforeEach(() => {
  resetOpaqueOAuthTokenValidation();
  resetJwtWarningLog();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function loggedLines(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join("\n");
}

describe("isClerkOAuthJwt", () => {
  test("recognises only at+jwt tokens from the configured issuer", async () => {
    expect(isClerkOAuthJwt(await sign())).toBe(true);
    expect(isClerkOAuthJwt(await sign({ typ: "application/at+jwt" }))).toBe(true);
    expect(isClerkOAuthJwt(await sign({ typ: "AT+JWT" }))).toBe(true);
    expect(isClerkOAuthJwt(await sign({ typ: "JWT" }))).toBe(false);
    expect(isClerkOAuthJwt(await sign({ typ: null }))).toBe(false);
    expect(isClerkOAuthJwt(await sign({ iss: "https://clerk.context7.com/" }))).toBe(false);
    expect(isClerkOAuthJwt(await sign({ iss: "https://evil.example" }))).toBe(false);
    expect(isClerkOAuthJwt("oat_abc")).toBe(false);
    expect(isClerkOAuthJwt("not.base64url!.x")).toBe(false);
    expect(isClerkOAuthJwt(undefined)).toBe(false);
  });

  test("is only a router: classification does not imply trust", async () => {
    const forged = await sign({ key: strangerKey });
    expect(isClerkOAuthJwt(forged)).toBe(true);
    expect(classifyAuthMethod(forged)).toBe("oauth");
    await expect(validateJWT(forged)).resolves.toEqual({
      valid: false,
      error: "Invalid signature",
    });
  });
});

describe("a valid Clerk OAuth JWT", () => {
  test("is accepted locally with no auth/check fetch and reported as oauth", async () => {
    const token = await sign();

    await expect(evaluateMcpAuthentication(token, "required")).resolves.toEqual({
      allowed: true,
      method: "oauth",
      event: "credential_validated",
      outcome: "accepted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(keys.remoteJwksUrls).toContain("https://clerk.context7.com/.well-known/jwks.json");
    expect(loggedLines()).toBe("");
  });

  test("accepts application/at+jwt and an audience array that includes this server", async () => {
    const token = await sign({
      typ: "application/at+jwt",
      aud: ["https://other.example/mcp", "https://MCP.context7.com/mcp/oauth/"],
    });

    await expect(validateJWT(token)).resolves.toEqual({ valid: true });
  });

  test("tolerates a minute of clock skew but no more", async () => {
    await expect(validateJWT(await sign({ expiresIn: -30 }))).resolves.toEqual({ valid: true });
    await expect(validateJWT(await sign({ expiresIn: -90 }))).resolves.toEqual({
      valid: false,
      error: "Token expired",
    });
  });
});

describe("an expired Clerk OAuth JWT", () => {
  test("gets a 401 with an invalid_token challenge in both modes", async () => {
    const token = await sign({ expiresIn: -600 });

    for (const mode of ["observe", "required"] as const) {
      const decision = await evaluateMcpAuthentication(token, mode);
      expect(decision).toEqual({
        allowed: false,
        method: "oauth",
        error: "Token expired",
        event: "credential_rejected",
        outcome: "expired",
      });
      expect(challenge(decision.allowed ? undefined : decision.error)).toBe(
        'Bearer error="invalid_token", error_description="Token expired", resource_metadata="https://mcp.context7.com/.well-known/oauth-protected-resource/mcp"'
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Clerk ID tokens and session JWTs", () => {
  test("are rejected with 401 whatever the audience enforcement", async () => {
    for (const enforcement of ["observe", "required"]) {
      vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", enforcement);
      for (const token of [await idToken(), await sessionJwt()]) {
        expect(classifyAuthMethod(token)).toBe("jwt");
        await expect(evaluateMcpAuthentication(token, "observe")).resolves.toEqual({
          allowed: false,
          method: "jwt",
          error: "Not an OAuth access token",
          event: "credential_rejected",
          outcome: "invalid",
        });
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("the ID token's audience (the OAuth client) is not an allowed audience either", async () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "required");
    // Same claims as the ID token but relabelled as an access token: the
    // audience check is the second line of defence.
    const relabelled = await sign({ aud: CLIENT_ID });
    await expect(validateJWT(relabelled)).resolves.toMatchObject({
      valid: false,
      error: "Token audience not accepted",
    });
  });
});

describe("audience enforcement", () => {
  const foreign = () => sign({ aud: "https://other-mcp.example/mcp" });

  test("observe (default) admits a foreign audience and logs the client and audience", async () => {
    const token = await foreign();

    await expect(evaluateMcpAuthentication(token, "required")).resolves.toMatchObject({
      allowed: true,
      method: "oauth",
      event: "credential_validated",
      outcome: "accepted",
    });

    const logged = loggedLines();
    expect(logged).toContain(
      `audienceMismatch clientId=${CLIENT_ID} aud=https://other-mcp.example/mcp enforcement=observe`
    );
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split(".")[2]);
  });

  test("logs the same mismatched token once, and each other token once", async () => {
    const missing = await sign({ aud: null });
    const other = await sign({ aud: null, claims: { client_id: CLIENT_ID, jti: "jti_other" } });

    for (let i = 0; i < 3; i += 1) {
      await expect(evaluateMcpAuthentication(missing, "required")).resolves.toMatchObject({
        allowed: true,
        outcome: "accepted",
      });
    }
    await expect(evaluateMcpAuthentication(other, "required")).resolves.toMatchObject({
      allowed: true,
    });

    const lines = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      `[Context7] audienceMismatch clientId=${CLIENT_ID} aud=missing enforcement=observe suppressedSincePrevious=0`,
      `[Context7] audienceMismatch clientId=${CLIENT_ID} aud=missing enforcement=observe suppressedSincePrevious=0`,
    ]);
  });

  test("observe logs a missing audience as such", async () => {
    const token = await sign({ aud: null, claims: {} });

    await expect(validateJWT(token)).resolves.toEqual({
      valid: true,
      warning: "audienceMismatch clientId=unknown aud=missing enforcement=observe",
    });
  });

  test("required rejects a foreign or missing audience with 401 and still logs it", async () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "required");

    for (const token of [await foreign(), await sign({ aud: null })]) {
      await expect(evaluateMcpAuthentication(token, "observe")).resolves.toEqual({
        allowed: false,
        method: "oauth",
        error: "Token audience not accepted",
        event: "credential_rejected",
        outcome: "invalid",
      });
    }
    expect(loggedLines()).toContain(
      `audienceMismatch clientId=${CLIENT_ID} aud=https://other-mcp.example/mcp enforcement=required`
    );
    expect(loggedLines()).toContain("aud=missing enforcement=required");

    await expect(evaluateMcpAuthentication(await sign(), "required")).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("MCP_OAUTH_ALLOWED_AUDIENCES replaces the default list", async () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "required");
    vi.stubEnv("MCP_OAUTH_ALLOWED_AUDIENCES", "http://localhost:8787/mcp/");

    await expect(validateJWT(await sign({ aud: "http://localhost:8787/mcp" }))).resolves.toEqual({
      valid: true,
    });
    await expect(validateJWT(await sign())).resolves.toMatchObject({ valid: false });
  });
});

describe("a Clerk OAuth JWT the Context7 API rejected", () => {
  test("is challenged on the next request without re-verification", async () => {
    const token = await sign();
    const now = Date.now();
    rememberInvalidOAuthToken(token, now);

    await expect(evaluateMcpAuthentication(token, "observe")).resolves.toEqual({
      allowed: false,
      method: "oauth",
      error: "The access token expired or is invalid",
      event: "credential_rejected",
      outcome: "expired",
    });

    // The memory is per token: a fresh token for the same user is unaffected.
    const refreshed = await sign({ claims: { client_id: CLIENT_ID, jti: "jti_456" } });
    await expect(evaluateMcpAuthentication(refreshed, "observe")).resolves.toMatchObject({
      allowed: true,
    });
  });

  test("is remembered by api.ts when a tool call answers 401 invalid_oauth_token", async () => {
    const token = await sign();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_oauth_token",
          message: "Invalid or expired OAuth token.",
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      )
    );

    const result = await searchLibraries("q", "react", { apiKey: token, transport: "http" });
    expect(result.error).toBe(
      "Your Context7 sign-in expired. Retry the request so your MCP client can refresh the sign-in."
    );
    expect(loggedLines()).not.toContain(token);

    await expect(evaluateMcpAuthentication(token, "required")).resolves.toMatchObject({
      allowed: false,
      outcome: "expired",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the opaque oat_ path", () => {
  test("still asks the Context7 API and never touches the JWKS", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(evaluateMcpAuthentication("oat_still_opaque", "required")).resolves.toEqual({
      allowed: true,
      method: "oauth",
      event: "credential_validated",
      outcome: "accepted",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/v2\/auth\/check$/);
  });
});
