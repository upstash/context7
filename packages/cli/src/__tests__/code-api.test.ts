import { describe, expect, test } from "vitest";
import {
  hasSourceCode,
  retryAfterSeconds,
  waitForLibraryCode,
  type CodeQueryResult,
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

describe("waitForLibraryCode", () => {
  const indexing: CodeQueryResult = { kind: "indexing", message: "being indexed", retryAfter: 30 };
  const ready: CodeQueryResult = { kind: "result", body: "src/a.ts:1: match" };

  /** A fake clock: each call takes `callMs`, and sleep moves the clock. */
  function harness(answers: CodeQueryResult[], callMs: number) {
    let clock = 0;
    let calls = 0;
    const waits: number[] = [];
    const query = async () => {
      clock += callMs;
      return answers[Math.min(calls++, answers.length - 1)]!;
    };
    const options = {
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      onWait: (_: unknown, secondsLeft: number) => waits.push(secondsLeft),
    };
    return { query, options, calls: () => calls, clock: () => clock, waits };
  }

  test("calls again while the source is indexed and returns the answer", async () => {
    const h = harness([indexing, indexing, ready], 20_000);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(ready);
    expect(h.calls()).toBe(3);
    expect(h.waits).toEqual([70, 47]);
  });

  test("starts no call that would end after the budget", async () => {
    const h = harness([indexing], 40_000);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(indexing);
    // 40 s, pause, 40 s: a third call would end at 126 s.
    expect(h.calls()).toBe(2);
    expect(h.clock()).toBeLessThanOrEqual(90_000);
  });

  test("a budget of 0 answers after one call, and a ready answer is never repeated", async () => {
    const none = harness([indexing], 1_000);
    expect(await waitForLibraryCode(none.query, 0, none.options)).toEqual(indexing);
    expect(none.calls()).toBe(1);
    const hit = harness([ready], 1_000);
    expect(await waitForLibraryCode(hit.query, 90_000, hit.options)).toEqual(ready);
    expect(hit.calls()).toBe(1);
  });
});
