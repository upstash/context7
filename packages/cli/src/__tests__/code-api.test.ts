import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CODE_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  getLibraryCode,
  hasSourceCode,
  retryAfterSeconds,
} from "../utils/api.js";

describe("hasSourceCode", () => {
  test("marks Git repository libraries, not websites or llms.txt", () => {
    expect(hasSourceCode({ id: "/colinhacks/zod", branch: "main" })).toBe(true);
    expect(hasSourceCode({ id: "/websites/zod_dev", branch: "_contextdev_" })).toBe(false);
    expect(hasSourceCode({ id: "/llmstxt/zod_dev_llms_txt", branch: "_llmstxt_" })).toBe(false);
    expect(hasSourceCode({ id: "/acme/docs", branch: "_contextdev_" })).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  test("prefers the body, then a header in seconds or as an HTTP date", () => {
    expect(retryAfterSeconds(12, "99")).toBe(12);
    expect(retryAfterSeconds(undefined, "45")).toBe(45);
    const fromDate = retryAfterSeconds(undefined, new Date(Date.now() + 60_000).toUTCString());
    expect(fromDate).toBeGreaterThan(50);
    expect(fromDate).toBeLessThanOrEqual(60);
  });

  test("never gives NaN", () => {
    expect(retryAfterSeconds(undefined, "soon")).toBe(30);
    expect(retryAfterSeconds(undefined, null)).toBe(30);
  });
});

describe("request timeouts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("gives the code call a timeout longer than the server's 40 s wait", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("src/a.ts:1: x"));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await getLibraryCode("/a/b", "x");

    expect(timeout).toHaveBeenCalledWith(CODE_REQUEST_TIMEOUT_MS);
    expect(CODE_REQUEST_TIMEOUT_MS).toBeGreaterThan(40_000);
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  test("turns a timeout into a clear error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"))
    );

    await expect(getLibraryCode("/a/b", "x")).rejects.toThrow(
      `Context7 did not answer within ${CODE_REQUEST_TIMEOUT_MS / 1000} seconds`
    );
  });

  test("passes other network errors through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchWithTimeout("https://example.test", {})).rejects.toThrow("fetch failed");
  });
});
