import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  isOpaqueOAuthToken,
  isOpaqueOAuthTokenValidationEnabled,
  rememberInvalidOpaqueOAuthToken,
  resetOpaqueOAuthTokenValidation,
  validateOpaqueOAuthToken,
} from "../src/lib/oauth-token-validation.js";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const rejected = () =>
  jsonResponse(401, {
    error: "invalid_oauth_token",
    message: "Invalid or expired OAuth token. Please re-authenticate to obtain a new token.",
  });

beforeEach(() => {
  resetOpaqueOAuthTokenValidation();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("opaque OAuth token validation", () => {
  test("recognises Clerk opaque tokens and the rollback switch", () => {
    expect(isOpaqueOAuthToken("oat_abc")).toBe(true);
    expect(isOpaqueOAuthToken("ctx7sk-abc")).toBe(false);
    expect(isOpaqueOAuthToken("a.b.c")).toBe(false);
    expect(isOpaqueOAuthToken(undefined)).toBe(false);

    expect(isOpaqueOAuthTokenValidationEnabled(undefined)).toBe(true);
    expect(isOpaqueOAuthTokenValidationEnabled("on")).toBe(true);
    expect(isOpaqueOAuthTokenValidationEnabled("off")).toBe(false);
    expect(isOpaqueOAuthTokenValidationEnabled(" OFF ")).toBe(false);
    expect(isOpaqueOAuthTokenValidationEnabled("0")).toBe(false);
  });

  test("asks the Context7 API with the bearer and accepts a 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(validateOpaqueOAuthToken("oat_valid")).resolves.toBe("valid");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v2\/auth\/check$/);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer oat_valid");
  });

  test("treats the API's invalid_oauth_token rejection as expired", async () => {
    fetchMock.mockResolvedValueOnce(rejected());

    await expect(validateOpaqueOAuthToken("oat_expired")).resolves.toBe("invalid");
  });

  test.each([
    ["a 401 with another error code", () => jsonResponse(401, { error: "unauthorized" })],
    ["a 404 before the endpoint is deployed", () => new Response(null, { status: 404 })],
    ["a 429", () => jsonResponse(429, { error: "Too Many Requests" })],
    ["a 503", () => new Response(null, { status: 503 })],
  ])("fails open on %s", async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response());

    await expect(validateOpaqueOAuthToken("oat_outage")).resolves.toBe("unavailable");
  });

  test("fails open when the check errors or times out", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted", "TimeoutError"));
    await expect(validateOpaqueOAuthToken("oat_timeout")).resolves.toBe("unavailable");

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(validateOpaqueOAuthToken("oat_network")).resolves.toBe("unavailable");
  });

  test("never logs the token", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed oat_secret-token"));
    await validateOpaqueOAuthToken("oat_secret-token");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await validateOpaqueOAuthToken("oat_other-secret");

    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("oat_");
  });

  test("caches a valid verdict for a minute and an invalid one for 30 seconds", async () => {
    const start = 1_000_000;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validateOpaqueOAuthToken("oat_valid", start)).resolves.toBe("valid");
    await expect(validateOpaqueOAuthToken("oat_valid", start + 59_000)).resolves.toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(rejected());
    await expect(validateOpaqueOAuthToken("oat_expired", start)).resolves.toBe("invalid");
    await expect(validateOpaqueOAuthToken("oat_expired", start + 29_000)).resolves.toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Each verdict is re-checked once its own TTL lapses.
    fetchMock.mockResolvedValueOnce(rejected());
    await expect(validateOpaqueOAuthToken("oat_expired", start + 31_000)).resolves.toBe("invalid");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validateOpaqueOAuthToken("oat_valid", start + 61_000)).resolves.toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("retries an unavailable verdict after a short hold", async () => {
    const start = 2_000_000;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(validateOpaqueOAuthToken("oat_outage", start)).resolves.toBe("unavailable");
    await expect(validateOpaqueOAuthToken("oat_outage", start + 5_000)).resolves.toBe(
      "unavailable"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validateOpaqueOAuthToken("oat_outage", start + 11_000)).resolves.toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("coalesces concurrent checks for the same token", async () => {
    let release!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (release = resolve)));

    const first = validateOpaqueOAuthToken("oat_burst");
    const second = validateOpaqueOAuthToken("oat_burst");
    release(new Response(null, { status: 204 }));

    await expect(Promise.all([first, second])).resolves.toEqual(["valid", "valid"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a data-request rejection overrides a cached positive verdict", async () => {
    const start = 3_000_000;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(validateOpaqueOAuthToken("oat_revoked", start)).resolves.toBe("valid");

    rememberInvalidOpaqueOAuthToken("oat_revoked", start + 1_000);

    await expect(validateOpaqueOAuthToken("oat_revoked", start + 2_000)).resolves.toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("bounds the cache size", async () => {
    const start = 4_000_000;
    for (let index = 0; index < 10_001; index += 1) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await validateOpaqueOAuthToken(`oat_${index}`, start);
    }
    expect(fetchMock).toHaveBeenCalledTimes(10_001);

    // The oldest entry was evicted; the newest survives.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await validateOpaqueOAuthToken("oat_0", start + 1);
    await validateOpaqueOAuthToken("oat_10000", start + 1);
    expect(fetchMock).toHaveBeenCalledTimes(10_002);
  });
});
