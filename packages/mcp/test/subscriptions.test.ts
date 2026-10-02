import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_MAX_SUBSCRIPTIONS,
  getMaxSubscriptions,
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

  test("drops only refusals caused by disabled subscriptions", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    logMcpHandlerError(
      "MCP handler error:",
      new Error("subscriptions/listen refused: subscription limit reached (0)")
    );

    expect(error).not.toHaveBeenCalled();
  });

  test.each(["subscriptions/listen refused: subscription limit reached (16000)", "real failure"])(
    "keeps unexpected failures visible: %s",
    (message) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const failure = new Error(message);
      logMcpHandlerError("MCP handler error:", failure);

      expect(error).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith("MCP handler error:", failure);
    }
  );
});
