import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_MAX_SUBSCRIPTIONS,
  getMaxSubscriptions,
  isSubscriptionLimitError,
  logMcpHandlerError,
} from "../src/lib/subscriptions.js";

describe("getMaxSubscriptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("disables subscriptions by default", () => {
    expect(getMaxSubscriptions(undefined)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
    expect(DEFAULT_MAX_SUBSCRIPTIONS).toBe(0);
  });

  test("accepts non-negative integer overrides", () => {
    expect(getMaxSubscriptions("0")).toBe(0);
    expect(getMaxSubscriptions("8192")).toBe(8_192);
  });

  test.each(["-1", "1.5", "invalid", "Infinity"])("falls back for invalid value %s", (value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getMaxSubscriptions(value)).toBe(DEFAULT_MAX_SUBSCRIPTIONS);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("logMcpHandlerError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("recognizes cap-0 listen refusals", () => {
    expect(isSubscriptionLimitError(new Error("subscription limit reached (0)"))).toBe(true);
    expect(isSubscriptionLimitError(new Error("boom"))).toBe(false);
  });

  test("drops expected listen refusals instead of logging them", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logMcpHandlerError("MCP handler error:", new Error("subscription limit reached (0)"));
    logMcpHandlerError("MCP handler error:", new Error("real failure"));

    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("MCP handler error:", expect.any(Error));
  });
});
