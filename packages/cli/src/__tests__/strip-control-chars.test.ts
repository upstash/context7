import { describe, expect, it } from "vitest";
import { stripControlChars } from "../utils/api.js";

describe("stripControlChars", () => {
  it("removes escape sequences from nested API content, keeps newlines and tabs", () => {
    const evil = "\x1b]52;c;ZWNobyBwd25k\x07\x1b[2J\x1b[Htitle\r\n\tok\x9b1m";
    expect(stripControlChars(evil)).toBe("]52;c;ZWNobyBwd25k[2J[Htitle\n\tok1m");
    expect(stripControlChars({ a: [evil, 1, null], b: { c: evil } })).toEqual({
      a: ["]52;c;ZWNobyBwd25k[2J[Htitle\n\tok1m", 1, null],
      b: { c: "]52;c;ZWNobyBwd25k[2J[Htitle\n\tok1m" },
    });
  });
});
