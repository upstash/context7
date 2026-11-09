import { describe, expect, test } from "vitest";
import { hasSourceCode, retryAfterSeconds } from "../utils/api.js";

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
