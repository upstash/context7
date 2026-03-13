import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";

vi.mock("os", () => ({ homedir: () => "/fake-home", default: { homedir: () => "/fake-home" } }));

vi.mock("fs", () => {
  const fns = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { ...fns, default: fns };
});

vi.mock("../constants.js", () => ({ CLI_CLIENT_ID: "test-client-id" }));
vi.mock("../utils/api.js", () => ({ getBaseUrl: () => "https://test.context7.com" }));

import * as fs from "fs";
import {
  generatePKCE,
  generateState,
  saveTokens,
  loadTokens,
  clearTokens,
  isTokenExpired,
  getValidAccessToken,
  exchangeCodeForTokens,
  buildAuthorizationUrl,
  createCallbackServer,
  type TokenData,
} from "../utils/auth.js";

const mfs = vi.mocked(fs);
const CREDENTIALS_PATH = "/fake-home/.context7/credentials.json";
const CONFIG_DIR_PATH = "/fake-home/.context7";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch not mocked for this test");
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generatePKCE", () => {
  test("returns codeVerifier and codeChallenge with correct SHA-256 relationship", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const expected = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
  });

  test("generates unique values on each call", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("generateState", () => {
  test("returns a base64url string", () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("generates unique values on each call", () => {
    expect(generateState()).not.toBe(generateState());
  });
});

describe("saveTokens", () => {
  test("creates config directory if it does not exist", () => {
    mfs.existsSync.mockReturnValue(false);
    saveTokens({ access_token: "tok", token_type: "bearer" });
    expect(mfs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR_PATH, { recursive: true, mode: 0o700 });
  });

  test("skips directory creation if it already exists", () => {
    mfs.existsSync.mockReturnValue(true);
    saveTokens({ access_token: "tok", token_type: "bearer" });
    expect(mfs.mkdirSync).not.toHaveBeenCalled();
  });

  test("writes credentials file with 0o600 permissions", () => {
    mfs.existsSync.mockReturnValue(true);
    saveTokens({ access_token: "tok", token_type: "bearer" });
    expect(mfs.writeFileSync).toHaveBeenCalledWith(CREDENTIALS_PATH, expect.any(String), {
      mode: 0o600,
    });
  });

  test("computes expires_at from expires_in when expires_at is absent", () => {
    mfs.existsSync.mockReturnValue(true);
    const now = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    saveTokens({ access_token: "tok", token_type: "bearer", expires_in: 3600 });
    const written = JSON.parse(mfs.writeFileSync.mock.calls[0][1] as string);
    expect(written.expires_at).toBe(now + 3600 * 1000);
  });

  test("preserves existing expires_at if already set", () => {
    mfs.existsSync.mockReturnValue(true);
    saveTokens({ access_token: "tok", token_type: "bearer", expires_at: 999, expires_in: 3600 });
    const written = JSON.parse(mfs.writeFileSync.mock.calls[0][1] as string);
    expect(written.expires_at).toBe(999);
  });
});

describe("loadTokens", () => {
  test("returns null when credentials file does not exist", () => {
    mfs.existsSync.mockReturnValue(false);
    expect(loadTokens()).toBeNull();
  });

  test("returns parsed TokenData when file exists", () => {
    const tokens: TokenData = { access_token: "tok", token_type: "bearer" };
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));
    expect(loadTokens()).toEqual(tokens);
  });

  test("returns null on malformed JSON", () => {
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue("not json");
    expect(loadTokens()).toBeNull();
  });
});

describe("clearTokens", () => {
  test("deletes file and returns true when it exists", () => {
    mfs.existsSync.mockReturnValue(true);
    expect(clearTokens()).toBe(true);
    expect(mfs.unlinkSync).toHaveBeenCalledWith(CREDENTIALS_PATH);
  });

  test("returns false when file does not exist", () => {
    mfs.existsSync.mockReturnValue(false);
    expect(clearTokens()).toBe(false);
    expect(mfs.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("isTokenExpired", () => {
  test("returns false when no expires_at is set", () => {
    expect(isTokenExpired({ access_token: "tok", token_type: "bearer" })).toBe(false);
  });

  test("returns false when well before expiry", () => {
    expect(
      isTokenExpired({
        access_token: "tok",
        token_type: "bearer",
        expires_at: Date.now() + 120_000,
      })
    ).toBe(false);
  });

  test("returns true when past expiry", () => {
    expect(
      isTokenExpired({ access_token: "tok", token_type: "bearer", expires_at: Date.now() - 1000 })
    ).toBe(true);
  });

  test("returns true within 60s buffer window", () => {
    expect(
      isTokenExpired({ access_token: "tok", token_type: "bearer", expires_at: Date.now() + 30_000 })
    ).toBe(true);
  });

  test("returns false at exactly 60s before expiry", () => {
    const now = 1000000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(
      isTokenExpired({ access_token: "tok", token_type: "bearer", expires_at: now + 60_000 })
    ).toBe(false);
  });
});

describe("getValidAccessToken", () => {
  test("returns null when no tokens stored", async () => {
    mfs.existsSync.mockReturnValue(false);
    expect(await getValidAccessToken()).toBeNull();
  });

  test("returns access_token when not expired", async () => {
    const tokens: TokenData = {
      access_token: "valid-tok",
      token_type: "bearer",
      expires_at: Date.now() + 120_000,
    };
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));
    expect(await getValidAccessToken()).toBe("valid-tok");
  });

  test("returns null when expired and no refresh_token", async () => {
    const tokens: TokenData = {
      access_token: "expired-tok",
      token_type: "bearer",
      expires_at: Date.now() - 1000,
    };
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));
    expect(await getValidAccessToken()).toBeNull();
  });

  test("refreshes token when expired and refresh_token exists", async () => {
    const tokens: TokenData = {
      access_token: "expired-tok",
      token_type: "bearer",
      expires_at: Date.now() - 1000,
      refresh_token: "refresh-tok",
    };
    const newTokens: TokenData = {
      access_token: "new-tok",
      token_type: "bearer",
      expires_in: 3600,
    };

    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(newTokens),
      })
    );

    const result = await getValidAccessToken();
    expect(result).toBe("new-tok");

    expect(fetch).toHaveBeenCalledWith(
      "https://test.context7.com/api/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("grant_type=refresh_token"),
      })
    );

    expect(mfs.writeFileSync).toHaveBeenCalled();
  });

  test("returns null when refresh fails", async () => {
    const tokens: TokenData = {
      access_token: "expired-tok",
      token_type: "bearer",
      expires_at: Date.now() - 1000,
      refresh_token: "refresh-tok",
    };

    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "invalid_grant" }),
      })
    );

    expect(await getValidAccessToken()).toBeNull();
  });
});

describe("exchangeCodeForTokens", () => {
  test("POSTs correct parameters and returns TokenData on success", async () => {
    const tokenResponse: TokenData = { access_token: "new-tok", token_type: "bearer" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      })
    );

    const result = await exchangeCodeForTokens(
      "https://example.com",
      "auth-code",
      "verifier",
      "http://localhost:52417/callback",
      "client-id"
    );

    expect(result).toEqual(tokenResponse);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("grant_type=authorization_code"),
      })
    );
    const body = vi.mocked(fetch).mock.calls[0][1]!.body as string;
    const params = new URLSearchParams(body);
    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("code")).toBe("auth-code");
    expect(params.get("code_verifier")).toBe("verifier");
    expect(params.get("redirect_uri")).toBe("http://localhost:52417/callback");
  });

  test("throws with error_description on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error_description: "bad code" }),
      })
    );

    await expect(
      exchangeCodeForTokens("https://example.com", "code", "verifier", "redirect", "client")
    ).rejects.toThrow("bad code");
  });

  test("throws generic message when response has no JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("no json")),
      })
    );

    await expect(
      exchangeCodeForTokens("https://example.com", "code", "verifier", "redirect", "client")
    ).rejects.toThrow("Failed to exchange code for tokens");
  });
});

describe("buildAuthorizationUrl", () => {
  test("constructs URL with all required parameters", () => {
    const result = buildAuthorizationUrl(
      "https://example.com",
      "client-id",
      "http://localhost:52417/callback",
      "challenge",
      "state-value"
    );

    const url = new URL(result);
    expect(url.origin).toBe("https://example.com");
    expect(url.pathname).toBe("/api/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:52417/callback");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("scope")).toBe("profile email");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("createCallbackServer", () => {
  async function httpGet(url: string): Promise<void> {
    const http = await import("http");
    return new Promise((resolve, reject) => {
      http
        .get(url, (res) => {
          res.resume();
          res.on("end", resolve);
        })
        .on("error", reject);
    });
  }

  function closeAndWait(closeFn: () => void): Promise<void> {
    return new Promise((resolve) => {
      closeFn();
      setTimeout(resolve, 100);
    });
  }

  test("resolves with code and state on valid callback", async () => {
    const server = createCallbackServer("expected-state");
    const port = await server.port;
    await httpGet(`http://127.0.0.1:${port}/callback?code=auth-code&state=expected-state`);
    const result = await server.result;
    expect(result).toEqual({ code: "auth-code", state: "expected-state" });
    await closeAndWait(server.close);
  });

  test("rejects on state mismatch", async () => {
    const server = createCallbackServer("expected-state");
    const resultPromise = server.result.catch((e: Error) => e);
    const port = await server.port;
    await httpGet(`http://127.0.0.1:${port}/callback?code=auth-code&state=wrong-state`);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("State mismatch");
    await closeAndWait(server.close);
  });

  test("rejects on missing code", async () => {
    const server = createCallbackServer("expected-state");
    const resultPromise = server.result.catch((e: Error) => e);
    const port = await server.port;
    await httpGet(`http://127.0.0.1:${port}/callback?state=expected-state`);
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Missing authorization code or state");
    await closeAndWait(server.close);
  });

  test("rejects on error parameter", async () => {
    const server = createCallbackServer("expected-state");
    const resultPromise = server.result.catch((e: Error) => e);
    const port = await server.port;
    await httpGet(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+cancelled`
    );
    const err = await resultPromise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("User cancelled");
    await closeAndWait(server.close);
  });
});
