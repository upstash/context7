import { describe, expect, test } from "vitest";
import { createPerTokenLogWindow } from "../src/lib/log-throttle.js";

describe("createPerTokenLogWindow", () => {
  test("admits a token once per window and reports what it suppressed", () => {
    const window = createPerTokenLogWindow(10_000);
    const start = 1_000_000;

    expect(window.admit("token-a", start)).toBe(0);
    expect(window.admit("token-a", start + 1)).toBeUndefined();
    expect(window.admit("token-a", start + 9_999)).toBeUndefined();

    // The next admission carries the two suppressed lines, then counts afresh.
    expect(window.admit("token-a", start + 10_000)).toBe(2);
    expect(window.admit("token-a", start + 10_001)).toBeUndefined();
    expect(window.admit("token-a", start + 20_000)).toBe(1);
  });

  test("keeps tokens independent", () => {
    const window = createPerTokenLogWindow(10_000);
    const start = 2_000_000;

    expect(window.admit("token-a", start)).toBe(0);
    expect(window.admit("token-b", start)).toBe(0);
    expect(window.admit("token-a", start + 1)).toBeUndefined();
    expect(window.admit("token-b", start + 1)).toBeUndefined();
  });

  test("bounds its size by evicting the oldest token", () => {
    const window = createPerTokenLogWindow(10_000, 2);
    const start = 3_000_000;

    window.admit("token-a", start);
    window.admit("token-b", start + 1);
    window.admit("token-c", start + 2);

    // token-a was evicted, so it logs again inside its window; token-c stays.
    expect(window.admit("token-a", start + 3)).toBe(0);
    expect(window.admit("token-c", start + 4)).toBeUndefined();
  });

  test("forgets everything on reset", () => {
    const window = createPerTokenLogWindow(10_000);
    window.admit("token-a", 0);
    window.reset();
    expect(window.admit("token-a", 1)).toBe(0);
  });
});
