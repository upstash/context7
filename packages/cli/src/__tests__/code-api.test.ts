import { describe, expect, test } from "vitest";
import {
  CODE_WAIT_MAX_CALLS,
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

  /**
   * A fake clock: each call takes `callMs`, sleep moves the clock, and a call
   * that would end after its deadline ends at the deadline with an abort.
   */
  function harness(answers: CodeQueryResult[], callMs: number) {
    let clock = 0;
    let calls = 0;
    const waits: number[] = [];
    const pauses: number[] = [];
    const deadlines = new Map<AbortSignal, { at: number; controller: AbortController }>();
    const query = async (signal?: AbortSignal) => {
      calls++;
      const limit = signal && deadlines.get(signal);
      if (limit && clock + callMs > limit.at) {
        clock = limit.at;
        limit.controller.abort();
        throw new DOMException("The operation timed out.", "TimeoutError");
      }
      clock += callMs;
      return answers[Math.min(calls - 1, answers.length - 1)]!;
    };
    const options = {
      now: () => clock,
      sleep: async (ms: number) => {
        pauses.push(ms);
        clock += ms;
      },
      deadline: (ms: number) => {
        const controller = new AbortController();
        deadlines.set(controller.signal, { at: clock + ms, controller });
        return controller.signal;
      },
      onWait: (_: unknown, secondsLeft: number) => waits.push(secondsLeft),
    };
    return { query, options, calls: () => calls, clock: () => clock, waits, pauses };
  }

  test("calls again while the source is indexed and returns the answer", async () => {
    const h = harness([indexing, indexing, ready], 20_000);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(ready);
    expect(h.calls()).toBe(3);
    expect(h.waits).toEqual([70, 47]);
  });

  test("makes a last call while more than 5 s are left and aborts it at the budget", async () => {
    // The server waits 40 s per call: 0-40 s, 43-83 s, then a last check from 85 s.
    const h = harness([indexing], 40_000);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(indexing);
    expect(h.calls()).toBe(3);
    expect(h.clock()).toBe(90_000);
  });

  test("uses the whole budget when the server waits 20 s per call", async () => {
    const h = harness([indexing], 20_000);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(indexing);
    // 0-20, 23-43, 46-66, 69-89 s: no stop at about 68 s.
    expect(h.calls()).toBe(4);
    expect(h.clock()).toBeGreaterThan(85_000);
    expect(h.clock()).toBeLessThanOrEqual(90_000);
  });

  test("pauses for retryAfter after a fast answer, within the budget", async () => {
    const h = harness([indexing], 200);
    expect(await waitForLibraryCode(h.query, 90_000, h.options)).toEqual(indexing);
    expect(h.pauses.slice(0, 2)).toEqual([30_000, 30_000]);
    expect(h.calls()).toBe(4);
    expect(h.clock()).toBeLessThanOrEqual(90_000);
  });

  test("caps the number of calls when fast answers ask for no pause", async () => {
    const h = harness([{ kind: "indexing", message: "being indexed", retryAfter: 0 }], 100);
    await waitForLibraryCode(h.query, 600_000, h.options);
    expect(h.calls()).toBe(CODE_WAIT_MAX_CALLS);
  });

  test("a budget of 0 answers after one call, and a ready answer is never repeated", async () => {
    const none = harness([indexing], 1_000);
    expect(await waitForLibraryCode(none.query, 0, none.options)).toEqual(indexing);
    expect(none.calls()).toBe(1);
    const hit = harness([ready], 1_000);
    expect(await waitForLibraryCode(hit.query, 90_000, hit.options)).toEqual(ready);
    expect(hit.calls()).toBe(1);
  });

  test("passes on an error that is not the budget's abort", async () => {
    const query = async () => {
      throw new Error("fetch failed");
    };
    await expect(waitForLibraryCode(query, 90_000)).rejects.toThrow("fetch failed");
  });
});
