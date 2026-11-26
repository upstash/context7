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

import { setBaseUrl } from "../utils/api.js";
import { resolveSetupApiKey } from "../setup/auth.js";

const BASE_URL = "https://test.context7.com";
const noContent = () => new Response(null, { status: 204 });
const errorBody = (status: number, error: string) =>
  Response.json({ error, message: "Connect with OAuth instead" }, { status });

describe("setup authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    setBaseUrl(BASE_URL);
  });

  test("uses a stored device-flow API key that the server still accepts", async () => {
    mockGetValidAccessToken.mockResolvedValue("ctx7sk-device-key");
    const fetchMock = vi.fn().mockResolvedValue(noContent());
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-device-key" });

    expect(mockPerformLogin).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v2/auth/check`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ctx7sk-device-key" }),
      })
    );
    expect(mockSpinner.start).not.toHaveBeenCalled();
  });

  test.each(["api_keys_disabled", "api_key_admins_only"])(
    "returns the refusal for a stored key the teamspace now refuses (%s), so setup uses OAuth",
    async (code) => {
      mockGetValidAccessToken.mockResolvedValue("ctx7sk-stored-key");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorBody(403, code)));

      await expect(resolveSetupApiKey()).resolves.toEqual({ refusal: code });
      expect(mockPerformLogin).not.toHaveBeenCalled();
    }
  );

  test("signs in again when the server no longer knows the stored key", async () => {
    mockGetValidAccessToken.mockResolvedValue("ctx7sk-revoked-key");
    mockPerformLogin.mockResolvedValue({ token: "ctx7sk-new-key" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorBody(401, "invalid_api_key")));

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-new-key" });
    expect(mockPerformLogin).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["another 403", () => errorBody(403, "access_denied")],
    ["a 503", () => errorBody(503, "auth_unavailable")],
  ])("keeps a stored key when the check answers %s", async (_case, response) => {
    mockGetValidAccessToken.mockResolvedValue("ctx7sk-stored-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-stored-key" });
    expect(mockPerformLogin).not.toHaveBeenCalled();
  });

  test("keeps a stored key when the check cannot reach the server", async () => {
    mockGetValidAccessToken.mockResolvedValue("ctx7sk-stored-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-stored-key" });
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { apiKey: "ctx7sk-generated-key" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSetupApiKey()).resolves.toEqual({ apiKey: "ctx7sk-generated-key" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/dashboard/api-keys`,
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
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorBody(403, code)));

      await expect(resolveSetupApiKey()).resolves.toEqual({ refusal: code });
      expect(mockSpinner.fail).not.toHaveBeenCalled();
    }
  );

  test("fails on any other 403", async () => {
    mockGetValidAccessToken.mockResolvedValue("legacy-oauth-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorBody(403, "access_denied")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resolveSetupApiKey()).resolves.toBeNull();
    expect(mockSpinner.fail).toHaveBeenCalledWith("Authentication failed");
  });
});
