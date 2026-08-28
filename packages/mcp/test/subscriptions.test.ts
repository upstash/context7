import { describe, expect, test } from "vitest";
import { DEFAULT_MAX_SUBSCRIPTIONS, getMaxSubscriptions } from "../src/lib/subscriptions.js";

describe("getMaxSubscriptions", () => {
  test("defaults to 16000 subscriptions", () => {
    expect(getMaxSubscriptions(undefined)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
  });

  test("accepts a positive integer override", () => {
    expect(getMaxSubscriptions("8192")).toBe(8_192);
  });

  test.each(["0", "-1", "1.5", "invalid", "Infinity"])(
    "falls back for invalid value %s",
    (value) => {
      expect(getMaxSubscriptions(value)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
    }
  );
});
