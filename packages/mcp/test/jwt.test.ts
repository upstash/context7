import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as jose from "jose";

vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof jose>("jose");
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(
      () => "fake-jwks" as unknown as ReturnType<typeof jose.createRemoteJWKSet>
    ),
    jwtVerify: vi.fn(),
  };
});

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const AUDIENCE = "6ff6a635-03d9-472d-a7f1-dc98a4e5fde2";

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
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  test("validates token after fetching tenant config", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        jsonData: { teamspaceId: "team-1", tenantId: TENANT_ID, requiredScope: "mcp.access" },
      })
    );
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { oid: "user-oid", scp: "mcp.access" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: ENTRA_ISSUER, aud: AUDIENCE }));

    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain(`/v2/entra/config/${AUDIENCE}`);
  });

  test("returns 'Unknown audience' when config endpoint returns 404", async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: false, status: 404 }));

    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: ENTRA_ISSUER, aud: "unknown-aud" }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Unknown audience");
    expect(jose.jwtVerify).not.toHaveBeenCalled();
  });

  test("returns 'Missing required scope' when scp claim lacks the configured scope", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({
        jsonData: { teamspaceId: "team-1", tenantId: TENANT_ID, requiredScope: "mcp.access" },
      })
    );
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { scp: "other.scope" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: ENTRA_ISSUER, aud: AUDIENCE }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing required scope");
  });

  test("returns 'Missing audience' for Entra issuer with no aud claim", async () => {
    const { validateJWT } = await loadModule();
    const result = await validateJWT(makeEntraToken({ iss: ENTRA_ISSUER }));

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Missing audience");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("caches config across repeated audiences", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      makeFetchResponse({
        jsonData: { teamspaceId: "team-1", tenantId: TENANT_ID, requiredScope: null },
      })
    );
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { oid: "u" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: ENTRA_ISSUER, aud: AUDIENCE });
    await validateJWT(token);
    await validateJWT(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not cache transient 500 errors — next request retries", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 500 }));
    fetchMock.mockResolvedValueOnce(
      makeFetchResponse({
        jsonData: { teamspaceId: "team-1", tenantId: TENANT_ID, requiredScope: null },
      })
    );
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { oid: "u" },
      protectedHeader: { alg: "RS256" },
    } as unknown as Awaited<ReturnType<typeof jose.jwtVerify>>);

    const { validateJWT } = await loadModule();
    const token = makeEntraToken({ iss: ENTRA_ISSUER, aud: AUDIENCE });

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
});
