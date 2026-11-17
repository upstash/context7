import { describe, expect, test } from "vitest";
import { indexingAnswer, isEmptyCodeResult } from "../src/lib/api.js";
import { grepRequest, rewriteCodeHints } from "../src/lib/code-tools.js";

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

describe("indexingAnswer", () => {
  test("drops the server's advice to keep calling and sends the agent to query-docs", () => {
    const text = indexingAnswer(
      'Git tag "v4.7.0" is not a docs version of /honojs/hono, so its source is being indexed from the tag. A first index usually takes 1 to 3 minutes, and longer for a very large repository. Call again in about 30 seconds, and keep calling until it answers, for up to 3 minutes. Meanwhile, or after that, answer from query-docs.',
      "grep-code"
    );
    expect(text).toBe(
      'Git tag "v4.7.0" is not a docs version of /honojs/hono, so its source is being indexed from the tag. A first index usually takes 1 to 3 minutes, and longer for a very large repository. This is not an error. Until the index is done, every code tool call for this version gives this answer, so do not try other patterns or files and do not wait: answer from query-docs now. Only if the source is still needed at the end of the task, call grep-code once more.'
    );
    expect(text).not.toMatch(/keep calling|call again/i);
  });

  test("works without a server message", () => {
    expect(indexingAnswer(undefined, "read-code")).toMatch(
      /^The library source is being indexed\. This is not an error\..*call read-code once more/
    );
  });
});

// Hint texts as the server's lib/code writes them, in terms of its operations and fields.
describe("rewriteCodeHints", () => {
  test("leaves paths, file names and quoted patterns alone", () => {
    expect(rewriteCodeHints("Next: read: packages/mcp/src/lib/query-code-tool.ts#L1-L40")).toBe(
      'Next: read-code with file_path "packages/mcp/src/lib/query-code-tool.ts", offset 1, limit 40'
    );
    expect(rewriteCodeHints("Next: read: src/ignore_case.py#L5-L45")).toContain(
      'file_path "src/ignore_case.py"'
    );
    expect(rewriteCodeHints('3 matching lines in 2 files for "fixed_strings"')).toBe(
      '3 matching lines in 2 files for "fixed_strings"'
    );
    expect(rewriteCodeHints("No match. Try ignore_case: true, or query-code again.")).toBe(
      "No match. Try -i: true, or grep-code again."
    );
  });

  test("keeps a path with spaces whole", () => {
    expect(rewriteCodeHints("Next: read: docs/My File.md#L1-L40 | more: offset 20")).toBe(
      'Next: read-code with file_path "docs/My File.md", offset 1, limit 40 | more: offset 20'
    );
  });

  test("turns a Next: read hint into a read-code call", () => {
    expect(rewriteCodeHints("Next: read: src/client.ts#L40-L80 | more: offset 20")).toBe(
      'Next: read-code with file_path "src/client.ts", offset 40, limit 41 | more: offset 20'
    );
    expect(rewriteCodeHints("Next: read: src/client.ts")).toBe(
      'Next: read-code with file_path "src/client.ts"'
    );
  });

  test("names the tool for each operation and the tool's own flags", () => {
    expect(
      rewriteCodeHints(
        'No file src/x.ts in the indexed source. Use operation "list" to see the files.'
      )
    ).toBe("No file src/x.ts in the indexed source. Find the files with glob-code.");
    expect(
      rewriteCodeHints(
        'Read the file with operation "read" and path "src/a.ts" (ctx7 code: --op read --path src/a.ts)'
      )
    ).toBe('Read the file: read-code with file_path "src/a.ts"');
    expect(rewriteCodeHints('Use operation "grep" or "definition" now.')).toBe(
      'Use grep-code or "definition" now.'
    );
    expect(rewriteCodeHints('or use operation "definition".')).toBe(
      'or use find-symbol with operation "definition".'
    );
    expect(rewriteCodeHints("Pass fixed_strings: true for text, or try ignore_case: true.")).toBe(
      "Pass -F: true for text, or try -i: true."
    );
  });

  test("leaves library source as it is", () => {
    const source =
      '<library-source>\nconst fixed_strings = opts.operation "read";\nNext: read: x\n</library-source>';
    expect(rewriteCodeHints(`Next: read: src/a.ts#L1-L2\n${source}\nset fixed_strings`)).toBe(
      `Next: read-code with file_path "src/a.ts", offset 1, limit 2\n${source}\nset -F`
    );
  });
});

describe("grepRequest", () => {
  const base = { libraryId: "/a/b", pattern: "x" };

  test("refuses a type with an include glob, which would widen the search", () => {
    expect(grepRequest({ ...base, type: "ts", glob: "src/**" })).toMatch(/not both/);
  });

  test("adds a type's globs to an exclude glob", () => {
    const request = grepRequest({ ...base, type: "py", glob: "!**/test/**" });
    expect(typeof request === "object" && request.glob).toEqual(["!**/test/**", "*.py", "*.pyi"]);
  });
});
