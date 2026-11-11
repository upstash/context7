import { describe, expect, test } from "vitest";
import { isEmptyCodeResult, retryAfterSeconds } from "../src/lib/api.js";

const HEADER =
  "Library: /colinhacks/zod at v3.24.2 (commit 0123456789ab, the commit the docs were built from) | License: MIT";

// Summary lines as the server's lib/code/format.ts writes them.
describe("isEmptyCodeResult", () => {
  test("finds an empty summary line after the header", () => {
    for (const summary of [
      '0 matching lines in 0 files for "parse"',
      'at least 0 matching lines in 0 files for "parse"',
      '0 references in 0 files to "parse"',
      "0 entries in src",
      "Symbols in src/a.ts (0 of 0):",
      "Exported API (0 of 0 symbols):",
      '0 definitions for "parse":',
    ]) {
      expect(isEmptyCodeResult(`${HEADER}\n${summary}`), summary).toBe(true);
    }
  });

  test("counts results and ignores the library source", () => {
    expect(isEmptyCodeResult(`${HEADER}\n3 matching lines in 1 file for "parse"`)).toBe(false);
    expect(isEmptyCodeResult(`${HEADER}\nExported API (1-50 of 120 symbols):`)).toBe(false);
    expect(
      isEmptyCodeResult(
        `${HEADER}\nFile: src/a.ts (lines 1-3)\n<library-source>\n0 entries in x\n</library-source>`
      )
    ).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  test("prefers the body, then a header in seconds or as an HTTP date", () => {
    expect(retryAfterSeconds(12, "99")).toBe(12);
    expect(retryAfterSeconds(undefined, "45")).toBe(45);
    const inOneMinute = new Date(Date.now() + 60_000).toUTCString();
    const fromDate = retryAfterSeconds(undefined, inOneMinute);
    expect(fromDate).toBeGreaterThan(50);
    expect(fromDate).toBeLessThanOrEqual(60);
  });

  test("never gives NaN", () => {
    expect(retryAfterSeconds(undefined, "soon")).toBe(30);
    expect(retryAfterSeconds("x", null)).toBe(30);
  });
});
