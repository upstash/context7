import { describe, expect, it, vi } from "vitest";

import { parsePortOption } from "../src/lib/cli-port.js";

describe("parsePortOption", () => {
  it("accepts valid ports", () => {
    expect(parsePortOption("3000")).toBe(3000);
    expect(parsePortOption("1")).toBe(1);
    expect(parsePortOption("65535")).toBe(65535);
  });

  it("rejects non-numeric, partial, and out-of-range ports (#3387)", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const raw of ["abc", "3001abc", "70000", "0", "-1", "", undefined]) {
        parsePortOption(raw);
        expect(exit).toHaveBeenCalledWith(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("Invalid --port value"));
        exit.mockClear();
        error.mockClear();
      }
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
