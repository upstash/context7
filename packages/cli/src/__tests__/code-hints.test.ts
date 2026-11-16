import { describe, expect, test } from "vitest";
import { cliCodeHints } from "../utils/codeHints.js";

const hint = (text: string) => cliCodeHints(text, "/acme/widgets");

describe("cliCodeHints", () => {
  test("rewrites a Next line into ctx7 code flags", () => {
    expect(
      hint(
        'Next: more results: call again with offset 20 | read: src/a.ts#L1-L40 | exact totals: call again with output_mode "count"'
      )
    ).toBe(
      "Next: more results: run again with --offset 20 | ctx7 code /acme/widgets --op read --path src/a.ts#L1-L40 | exact totals: run again with -c"
    );
    expect(hint("Next: read: src/a.ts#L5-L45")).toBe(
      "Next: ctx7 code /acme/widgets --op read --path src/a.ts#L5-L45"
    );
  });

  test("rewrites field names in notes and messages", () => {
    expect(hint("Check the spelling, drop a glob, or try ignore_case: true")).toBe(
      "Check the spelling, drop a glob, or try -i"
    );
    expect(
      hint(
        "The pattern has regex characters such as $ or (: set fixed_strings: true to match them as text"
      )
    ).toBe("The pattern has regex characters such as $ or (: add -F to match them as text");
    expect(hint("Pass fixed_strings: true for text.")).toBe("Add -F for text.");
    expect(hint('Use operation "list" to see the files.')).toBe("Use --op list to see the files.");
    expect(hint('Use operation "read" with path to read files.')).toBe(
      "Use --op read with --path to read files."
    );
    expect(hint("head_limit is at most 100 in files_with_matches mode")).toBe(
      "--head-limit is at most 100 in files_with_matches mode"
    );
  });

  test("leaves the source inside library-source frames as it is", () => {
    const text = [
      "Library: /acme/widgets at main",
      "<library-source>",
      "src/a.ts:3:  // call again with offset 20 and set fixed_strings: true",
      "</library-source>",
      "Next: read: src/a.ts#L1-L40",
    ].join("\n");
    expect(hint(text).split("\n")).toEqual([
      "Library: /acme/widgets at main",
      "<library-source>",
      "src/a.ts:3:  // call again with offset 20 and set fixed_strings: true",
      "</library-source>",
      "Next: ctx7 code /acme/widgets --op read --path src/a.ts#L1-L40",
    ]);
  });
});
