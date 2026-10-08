import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as jose from "jose";

const ENTRA_KEYS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys";
// Stands in for Microsoft's common key set; filled with a local key pair per test.
const entraKeys = vi.hoisted(() => ({ set: { keys: [] as (jose.JWK & { issuer?: string })[] } }));

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof jose>("jose");
  return {
    ...actual,
    createRemoteJWKSet: vi.fn((url: URL) =>
      url.href === ENTRA_KEYS_URL
        ? Object.assign(
            (header: jose.JWSHeaderParameters, token: jose.FlattenedJWSInput) =>
              actual.createLocalJWKSet(entraKeys.set)(header, token),
            { jwks: () => entraKeys.set }
          )
        : ("fake-jwks" as unknown as ReturnType<typeof jose.createRemoteJWKSet>)
    ),
    jwtVerify: vi.fn(),
  };
});

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const AUDIENCE = "6ff6a635-03d9-472d-a7f1-dc98a4e5fde2";
const originalOAuthAuthServerUrl = process.env.OAUTH_AUTH_SERVER_URL;
const originalOAuthJwksUrl = process.env.OAUTH_JWKS_URL;
const VERCEL_ISSUER = "https://integrations.vercel.com/oac_123456789";
const VERCEL_AUDIENCE = "https://integrations.vercel.com/context7/icfg_1234567890";

async function loadModule() {
  vi.resetModules();
  return import("../src/lib/jwt.js");
}

function makeFetchResponse(init: Partial<Response> & { jsonData?: unknown }): Response {
  const { jsonData, ...rest } = init;
  return {
    ok: true,
    status: 200,
    json: async () => jsonData,
    ...rest,
  } as Response;
}

function makeEntraToken(payload: jose.JWTPayload): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("VERCEL_MARKETPLACE_OIDC_ISSUER", VERCEL_ISSUER);
  vi.stubEnv("VERCEL_MARKETPLACE_OIDC_AUDIENCE", VERCEL_AUDIENCE);
});

afterEach(() => {
  if (originalOAuthAuthServerUrl === undefined) {
    delete process.env.OAUTH_AUTH_SERVER_URL;
  } else {
    process.env.OAUTH_AUTH_SERVER_URL = originalOAuthAuthServerUrl;
  }
  if (originalOAuthJwksUrl === undefined) {
    delete process.env.OAUTH_JWKS_URL;
  } else {
    process.env.OAUTH_JWKS_URL = originalOAuthJwksUrl;
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("isJWT", () => {
  test("returns true for 3-part dotted strings", async () => {
    const { isJWT } = await loadModule();
    expect(isJWT("a.b.c")).toBe(true);
  });

  test("returns false for non-JWT strings", async () => {
    const { isJWT } = await loadModule();
    expect(isJWT("not-a-jwt")).toBe(false);
    expect(isJWT("only.two")).toBe(false);
    expect(isJWT("a.b.c.d")).toBe(false);
  });
});

describe("validateJWT - Entra path", () => {
  const KID = "entra-test-key";
  let privateKey: CryptoKey;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof jose>("jose");
    vi.mocked(jose.jwtVerify).mockImplementation(actual.jwtVerify);
    const pair = await jose.generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const jwk = await jose.exportJWK(pair.publicKey);
    entraKeys.set = {
      keys: [{ ...jwk, kid: KID, issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" }],
    };
  });

  function signEntraToken(aud: string, claims: jose.JWTPayload = {}, key = privateKey) {
    return new jose.SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(ENTRA_ISSUER)
      .setAudience(aud)
      .setExpirationTime("5m")
      .sign(key);
  }

  function mockConfig(config: { tenantId: string; requiredScope: string | null }) {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ jsonData: { teamspaceId: "team-1", ...config } })
    );
  }

  test("rejects forged tokens before any config lookup", async () => {
    const { privateKey: attackerKey } = await jose.generateKeyPair("RS256");
    const { validateJWT } = await loadModule();

    for (const token of [
      makeEntraToken({ iss: ENTRA_ISSUER, aud: AUDIENCE }),
      new jose.UnsecuredJWT({ iss: ENTRA_ISSUER, aud: AUDIENCE }).encode(),
      await signEntraToken(AUDIENCE, {}, attackerKey),
    ]) {
      expect((await validateJWT(token)).valid).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects a key that Microsoft scopes to another issuer", async () => {
    entraKeys.set.keys[0].issuer =
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
    const { validateJWT } = await loadModule();

    const result = await validateJWT(await signEntraToken(AUDIENCE));

    expect(result).toEqual({ valid: false, error: "Invalid signature" });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("accepts a signed token after fetching the audience config", async () => {
    mockConfig({ tenantId: TENANT_ID, requiredScope: "mcp.access" });
    const { validateJWT } = await loadModule();

    const result = await validateJWT(await signEntraToken(AUDIENCE, { scp: "mcp.access" }));

    expect(result).toEqual({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain(`/v2/entra/config/${AUDIENCE}`);
  });

  test("rejects a token whose issuer tenant differs from the configured tenant", async () => {
    mockConfig({ tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", requiredScope: null });
    const { validateJWT } = await loadModule();

    const result = await validateJWT(await signEntraToken(AUDIENCE));

    expect(result).toEqual({ valid: false, error: "Invalid token claims" });
  });

  test("returns 'Unknown audience' when config endpoint returns 404", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: false, status: 404 }));
    const { validateJWT } = await loadModule();

    const result = await validateJWT(await signEntraToken("unknown-aud"));

    expect(result).toEqual({ valid: false, error: "Unknown audience" });
  });

  test("returns 'Missing required scope' when scp claim lacks the configured scope", async () => {
    mockConfig({ tenantId: TENANT_ID, requiredScope: "mcp.access" });
    const { validateJWT } = await loadModule();

    const result = await validateJWT(await signEntraToken(AUDIENCE, { scp: "other.scope" }));

    expect(result).toEqual({ valid: false, error: "Missing required scope" });
  });

  test("returns 'Missing audience' for Entra issuer with no aud claim", async () => {
    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: ENTRA_ISSUER }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing audience");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("caches config across repeated audiences", async () => {
    mockConfig({ tenantId: TENANT_ID, requiredScope: null });
    const { validateJWT } = await loadModule();
    const token = await signEntraToken(AUDIENCE);
    await validateJWT(token);
    await validateJWT(token);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("caps the config cache and evicts the oldest audience", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: false, status: 404 }));
    const { validateJWT } = await loadModule();

    for (let i = 0; i <= 1000; i++) await validateJWT(await signEntraToken(`aud-${i}`));
    expect(fetch).toHaveBeenCalledTimes(1001);

    await validateJWT(await signEntraToken("aud-1000"));
    expect(fetch).toHaveBeenCalledTimes(1001);
    await validateJWT(await signEntraToken("aud-0"));
    expect(fetch).toHaveBeenCalledTimes(1002);
  });

  test("does not cache transient 500 errors — next request retries", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 500 }));
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        jsonData: { teamspaceId: "team-1", tenantId: TENANT_ID, requiredScope: null },
      })
    );
    const { validateJWT } = await loadModule();
    const token = await signEntraToken(AUDIENCE);

    const first = await validateJWT(token);
    expect(first.valid).toBe(false);
    expect(first.error).toBe("Unknown audience");

    const second = await validateJWT(token);
    expect(second.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("validateJWT - Clerk path", () => {
  test("verifies against Clerk JWKS for non-Entra issuers", async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: {},
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: "https://clerk.context7.com" }));

    expect(result.valid).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns 'Token expired' when jwtVerify throws JWTExpired", async () => {
    vi.mocked(jose.jwtVerify).mockRejectedValue(
      new jose.errors.JWTExpired("expired", { payload: {}, protectedHeader: { alg: "RS256" } })
    );

    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: "https://clerk.context7.com" }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Token expired");
  });

  test("uses the configured OAuth issuer and its JWKS for verification", async () => {
    process.env.OAUTH_AUTH_SERVER_URL = "https://supreme-foal-19.clerk.accounts.dev/";
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: {},
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const result = await validateJWT(
      makeEntraToken({ iss: "https://supreme-foal-19.clerk.accounts.dev" })
    );

    expect(result.valid).toBe(true);
    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://supreme-foal-19.clerk.accounts.dev/.well-known/jwks.json")
    );
    expect(jose.jwtVerify).toHaveBeenCalledWith(expect.any(String), "fake-jwks", {
      issuer: "https://supreme-foal-19.clerk.accounts.dev",
    });
  });

  test("allows an explicit JWKS URL without changing the OAuth issuer", async () => {
    process.env.OAUTH_AUTH_SERVER_URL = "https://oauth.example.com";
    process.env.OAUTH_JWKS_URL = "https://keys.example.com/oauth/jwks.json";

    await loadModule();

    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://keys.example.com/oauth/jwks.json")
    );
  });
});

describe("validateJWT - Vercel Marketplace OIDC path", () => {
  test("verifies the exact issuer, audience, time window, and resource", async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: {
        resource: "teamspace-resource-123",
        sub: "user_123",
        act: "owner:team1:project:p1:environment:production",
      },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: VERCEL_ISSUER, aud: VERCEL_AUDIENCE });

    await expect(validateJWT(token)).resolves.toEqual({ valid: true });
    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL(`${VERCEL_ISSUER}/.well-known/jwks`)
    );
    expect(jose.jwtVerify).toHaveBeenCalledWith(token, "fake-jwks", {
      algorithms: ["RS256"],
      audience: VERCEL_AUDIENCE,
      issuer: VERCEL_ISSUER,
      clockTolerance: 60,
    });
  });

  test("does not trust lookalike Vercel hosts", async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: {},
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({
      iss: "https://integrations.vercel.com.attacker.test/oac_123456789",
    });

    await validateJWT(token);
    expect(jose.jwtVerify).toHaveBeenCalledWith(token, "fake-jwks", {
      issuer: "https://clerk.context7.com",
    });
  });

  test("rejects tokens from another Vercel integration", async () => {
    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: "https://integrations.vercel.com/oac_987654321" });

    await expect(validateJWT(token)).resolves.toEqual({
      valid: false,
      error: "Untrusted Vercel Marketplace issuer",
    });
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  test("fails closed when Marketplace OIDC is not configured", async () => {
    vi.stubEnv("VERCEL_MARKETPLACE_OIDC_ISSUER", "");
    vi.stubEnv("VERCEL_MARKETPLACE_OIDC_AUDIENCE", "");

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: VERCEL_ISSUER });

    await expect(validateJWT(token)).resolves.toEqual({
      valid: false,
      error: "Vercel Marketplace OIDC not configured",
    });
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  test("requires Vercel's immutable resource claim", async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: {},
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: VERCEL_ISSUER, aud: VERCEL_AUDIENCE });

    await expect(validateJWT(token)).resolves.toEqual({
      valid: false,
      error: "Missing Vercel Marketplace resource",
    });
  });
});
