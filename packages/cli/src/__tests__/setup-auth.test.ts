import { beforeEach, describe, expect, test, vi } from "vitest";

const mockGetValidAccessToken = vi.fn();
vi.mock("../utils/auth.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils/auth.js")>();
  return {
    ...original,
    getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
  };
});

const mockPerformLogin = vi.fn();
vi.mock("../commands/auth.js", () => ({
  performDeviceLogin: (...args: unknown[]) => mockPerformLogin(...args),
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
};
vi.mock("ora", () => ({ default: () => mockSpinner }));

vi.mock("../utils/api.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../utils/api.js")>();
  return {
    ...original,
    getBaseUrl: () => "https://test.context7.com",
  };
});

import { resolveSetupApiKey } from "../setup/auth.js";

describe("setup authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  test("uses a stored device-flow API key directly", async () => {
    mockGetValidAccessToken.mockResolvedValue("ctx7sk-device-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-device-key" });

    expect(mockPerformLogin).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockSpinner.start).not.toHaveBeenCalled();
  });

  test("uses a newly authenticated device-flow API key directly", async () => {
    mockGetValidAccessToken.mockResolvedValue(undefined);
    mockPerformLogin.mockResolvedValue({ token: "ctx7sk-new-key" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-new-key" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns the refusal when the device login is refused a key, so setup uses OAuth", async () => {
    mockGetValidAccessToken.mockResolvedValue(undefined);
    mockPerformLogin.mockResolvedValue({ refusal: "api_key_admins_only" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ refusal: "api_key_admins_only" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("still exchanges a legacy OAuth access token for an API key", async () => {
    mockGetValidAccessToken.mockResolvedValue("legacy-oauth-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { apiKey: "ctx7sk-generated-key" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-generated-key" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test.context7.com/api/dashboard/api-keys",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer legacy-oauth-token" }),
      })
    );
  });

  test.each(["api_keys_disabled", "api_key_admins_only"])(
    "reports a %s refusal instead of failing",
    async (code) => {
      mockGetValidAccessToken.mockResolvedValue("legacy-oauth-token");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: code, message: "Connect with OAuth instead" }),
        })
      );

      await expect(resolveSetupApiKey()).resolves.toEqual({ refusal: code });
      expect(mockSpinner.fail).not.toHaveBeenCalled();
    }
  );

  test("fails on any other 403", async () => {
    mockGetValidAccessToken.mockResolvedValue("legacy-oauth-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "access_denied", message: "No access" }),
      })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveSetupApiKey()).resolves.toBeNull();
    expect(mockSpinner.fail).toHaveBeenCalledWith("Authentication failed");
  });
});
