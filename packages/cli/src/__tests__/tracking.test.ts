import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { DEFAULT_CONTEXT7_BASE_URL, getBaseUrl } = vi.hoisted(() => ({
  DEFAULT_CONTEXT7_BASE_URL: "https://context7.com",
  getBaseUrl: vi.fn(() => "https://context7.com"),
}));

vi.mock("../utils/api.js", () => ({
  DEFAULT_CONTEXT7_BASE_URL,
  getBaseUrl,
}));

import { trackEvent } from "../utils/tracking.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response()))
  );
  vi.stubEnv("CTX7_TELEMETRY_DISABLED", "");
  getBaseUrl.mockReturnValue(DEFAULT_CONTEXT7_BASE_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("trackEvent", () => {
  test("sends hosted CLI events", () => {
    trackEvent("command", { name: "setup" });

    expect(fetch).toHaveBeenCalledWith(`${DEFAULT_CONTEXT7_BASE_URL}/api/v2/cli/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "command", data: { name: "setup" } }),
    });
  });

  test("does not send CLI events to a custom deployment", () => {
    getBaseUrl.mockReturnValue("https://context7.internal.example");

    trackEvent("command", { name: "setup" });

    expect(fetch).not.toHaveBeenCalled();
  });
});
