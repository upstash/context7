import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("fs", () => {
  const fns = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    renameSync: vi.fn(),
    chmodSync: vi.fn(),
  };
  return { ...fns, default: fns };
});

vi.mock("../constants.js", () => ({ CLI_CLIENT_ID: "test-client-id" }));
vi.mock("../utils/api.js", () => ({ getBaseUrl: () => "https://test.context7.com" }));

import * as fs from "fs";
import {
  saveTokens,
  loadTokens,
  clearTokens,
  isTokenExpired,
  getValidAccessToken,
  startDeviceAuthorization,
  pollDeviceToken,
  type TokenData,
} from "../utils/auth.js";

const mfs = vi.mocked(fs);
const CREDENTIALS_PATH = "/fake-home/.config/context7/credentials.json";
const LEGACY_CREDENTIALS_PATH = "/fake-home/.context7/credentials.json";
const CONFIG_DIR_PATH = "/fake-home/.config/context7";

beforeEach(() => {
  vi.clearAllMocks();
  // os.homedir() reads $HOME first on POSIX, so stubbing the env var pins the
  // home directory deterministically without mocking the `os` builtin (which
  // resolves unreliably across Node versions / worker pooling in CI).
  vi.stubEnv("HOME", "/fake-home");
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  vi.stubEnv("XDG_STATE_HOME", undefined);
  vi.stubEnv("XDG_CACHE_HOME", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch not mocked for this test");
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

  test("enforces 0o600 even when the credentials file already exists", () => {
    // writeFileSync's mode is ignored for an existing file, so chmod must run.
    mfs.existsSync.mockReturnValue(true);
    saveTokens({ access_token: "tok", token_type: "bearer" });
    expect(mfs.chmodSync).toHaveBeenCalledWith(CREDENTIALS_PATH, 0o600);
  });

  test("honors XDG_CONFIG_HOME for credentials", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/custom-config");
    mfs.existsSync.mockReturnValue(false);
    saveTokens({ access_token: "tok", token_type: "bearer" });

    expect(mfs.mkdirSync).toHaveBeenCalledWith("/custom-config/context7", {
      recursive: true,
      mode: 0o700,
    });
    expect(mfs.writeFileSync).toHaveBeenCalledWith(
      "/custom-config/context7/credentials.json",
      expect.any(String),
      { mode: 0o600 }
    );
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

  test("migrates credentials from the legacy ~/.context7 path before reading", () => {
    const tokens: TokenData = { access_token: "tok", token_type: "bearer" };
    let migrated = false;
    mfs.existsSync.mockImplementation((filePath) =>
      filePath === CREDENTIALS_PATH
        ? migrated
        : filePath === LEGACY_CREDENTIALS_PATH || filePath === CONFIG_DIR_PATH
    );
    mfs.renameSync.mockImplementation(() => {
      migrated = true;
    });
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));

    expect(loadTokens()).toEqual(tokens);
    expect(mfs.renameSync).toHaveBeenCalledWith(LEGACY_CREDENTIALS_PATH, CREDENTIALS_PATH);
    // rename preserves the legacy mode, so migration must re-assert 0o600.
    expect(mfs.chmodSync).toHaveBeenCalledWith(CREDENTIALS_PATH, 0o600);
    expect(mfs.readFileSync).toHaveBeenCalledWith(CREDENTIALS_PATH, "utf-8");
  });

  test("returns null on malformed JSON", () => {
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue("not json");
    expect(loadTokens()).toBeNull();
  });

  test("falls back to the legacy file (no throw) when migration fails", () => {
    const tokens: TokenData = { access_token: "tok", token_type: "bearer" };
    // Only the legacy file exists; the rename fails (e.g. EXDEV / EACCES).
    mfs.existsSync.mockImplementation((filePath) => filePath === LEGACY_CREDENTIALS_PATH);
    mfs.renameSync.mockImplementation(() => {
      throw new Error("EXDEV: cross-device link not permitted");
    });
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));

    expect(() => loadTokens()).not.toThrow();
    expect(loadTokens()).toEqual(tokens);
    expect(mfs.readFileSync).toHaveBeenCalledWith(LEGACY_CREDENTIALS_PATH, "utf-8");
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

describe("startDeviceAuthorization", () => {
  test("returns parsed response on 200", async () => {
    const payload = {
      device_code: "dc",
      user_code: "ABCD-EFGH",
      verification_uri: "https://t.example/oauth/device",
      verification_uri_complete: "https://t.example/oauth/device?user_code=ABCD-EFGH",
      expires_in: 600,
      interval: 5,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) })
    );
    await expect(startDeviceAuthorization("https://t.example", "test-client")).resolves.toEqual(
      payload
    );
  });

  test("POSTs client_id as form-encoded body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          device_code: "",
          user_code: "",
          verification_uri: "",
          expires_in: 0,
          interval: 5,
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await startDeviceAuthorization("https://t.example", "test-client");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://t.example/api/oauth/device/code");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    // Body is form-encoded; hostname is appended best-effort and varies by
    // machine, so assert on the parsed client_id rather than the exact string.
    expect(new URLSearchParams(init.body as string).get("client_id")).toBe("test-client");
  });

  test("throws with the server-provided error_description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({ error: "invalid_request", error_description: "bad client_id" }),
      })
    );
    await expect(startDeviceAuthorization("https://t", "bogus")).rejects.toThrow("bad client_id");
  });
});

describe("pollDeviceToken", () => {
  test("approved on 200 returns tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: "ctx7sk-x", token_type: "bearer" }),
      })
    );
    const result = await pollDeviceToken("https://t", "c", "dc");
    expect(result.status).toBe("approved");
    expect(result.tokens?.access_token).toBe("ctx7sk-x");
  });

  test.each([
    ["authorization_pending", "pending"],
    ["slow_down", "slow_down"],
    ["access_denied", "denied"],
    ["expired_token", "expired"],
  ] as const)("maps %s -> %s", async (serverError, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: serverError }),
      })
    );
    expect((await pollDeviceToken("https://t", "c", "dc")).status).toBe(expected);
  });

  test("returns transient on a 5xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "server_error" }),
      })
    );
    const result = await pollDeviceToken("https://t", "c", "dc");
    expect(result.status).toBe("transient");
    expect(result.errorMessage).toBeTruthy();
  });

  test("returns transient on a fetch network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await pollDeviceToken("https://t", "c", "dc");
    expect(result.status).toBe("transient");
    expect(result.errorMessage).toBe("ECONNREFUSED");
  });

  test("throws on unknown 4xx error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ error: "invalid_grant", error_description: "device_code malformed" }),
      })
    );
    await expect(pollDeviceToken("https://t", "c", "dc")).rejects.toThrow("device_code malformed");
  });
});
