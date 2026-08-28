import { afterEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_MAX_SUBSCRIPTIONS, getMaxSubscriptions } from "../src/lib/subscriptions.js";

describe("getMaxSubscriptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("defaults to 16000 subscriptions", () => {
    expect(getMaxSubscriptions(undefined)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
  });

  test("accepts a positive integer override", () => {
    expect(getMaxSubscriptions("8192")).toBe(8_192);
  });

  test.each(["0", "-1", "1.5", "invalid", "Infinity"])(
    "falls back for invalid value %s",
    (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(getMaxSubscriptions(value)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
      expect(warn).toHaveBeenCalledOnce();
    }
  );
});
