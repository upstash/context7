import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import {
  resolveCredentialStore,
  resetCredentialStoreForTests,
} from "../utils/credential-store/index.js";
import { JsonCredentialStore, normalizeTokenData } from "../utils/credential-store/json-store.js";
import {
  isKeyringAvailable,
  KeyringCredentialStore,
  resetKeytarCacheForTests,
} from "../utils/credential-store/keyring-store.js";

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

const mockKeytar = {
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn(),
  findPassword: vi.fn(),
};

vi.mock("keytar", () => ({
  default: mockKeytar,
  ...mockKeytar,
}));

const mfs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
  resetCredentialStoreForTests();
  resetKeytarCacheForTests();
  vi.stubEnv("HOME", "/fake-home");
  vi.stubEnv("XDG_CONFIG_HOME", undefined);
  vi.stubEnv("CTX7_CREDENTIAL_STORE", undefined);
  mockKeytar.findPassword.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCredentialStoreForTests();
  resetKeytarCacheForTests();
});

describe("normalizeTokenData", () => {
  test("computes expires_at from expires_in", () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const normalized = normalizeTokenData({
      access_token: "tok",
      token_type: "bearer",
      expires_in: 120,
    });
    expect(normalized.expires_at).toBe(now + 120_000);
  });
});

describe("resolveCredentialStore", () => {
  test("uses json store when CTX7_CREDENTIAL_STORE=json", async () => {
    vi.stubEnv("CTX7_CREDENTIAL_STORE", "json");
    const store = await resolveCredentialStore();
    expect(store.backend).toBe("json");
  });

  test("uses keyring store when CTX7_CREDENTIAL_STORE=keyring and keyring is available", async () => {
    vi.stubEnv("CTX7_CREDENTIAL_STORE", "keyring");
    const store = await resolveCredentialStore();
    expect(store.backend).toBe("keyring");
  });

  test("throws when keyring mode is forced but unavailable", async () => {
    vi.stubEnv("CTX7_CREDENTIAL_STORE", "keyring");
    mockKeytar.findPassword.mockRejectedValue(new Error("no keyring"));
    resetKeytarCacheForTests();
    await expect(resolveCredentialStore()).rejects.toThrow(/not available/i);
  });

  test("falls back to json when auto mode and keyring is unavailable", async () => {
    mockKeytar.findPassword.mockRejectedValue(new Error("no keyring"));
    resetKeytarCacheForTests();
    const store = await resolveCredentialStore();
    expect(store.backend).toBe("json");
  });

  test("migrates json credentials into keyring on first resolve in auto mode", async () => {
    const tokens = { access_token: "ctx7sk-test", token_type: "bearer" };
    mfs.existsSync.mockReturnValue(true);
    mfs.readFileSync.mockReturnValue(JSON.stringify(tokens));

    const store = await resolveCredentialStore();
    expect(store.backend).toBe("keyring");
    expect(mockKeytar.setPassword).toHaveBeenCalled();
    expect(mfs.unlinkSync).toHaveBeenCalled();
  });
});

describe("KeyringCredentialStore", () => {
  test("round-trips token data", async () => {
    const tokens = { access_token: "ctx7sk-test", token_type: "bearer", expires_at: 123 };
    mockKeytar.getPassword.mockResolvedValue(JSON.stringify(tokens));

    const store = new KeyringCredentialStore();
    await expect(store.load()).resolves.toEqual(tokens);
  });

  test("reports availability via isKeyringAvailable", async () => {
    await expect(isKeyringAvailable()).resolves.toBe(true);
  });
});

describe("JsonCredentialStore", () => {
  test("writes normalized token data", async () => {
    mfs.existsSync.mockReturnValue(false);
    const store = new JsonCredentialStore();
    await store.save({ access_token: "tok", token_type: "bearer", expires_in: 60 });
    expect(mfs.writeFileSync).toHaveBeenCalled();
  });
});
