import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CodeSearchError,
  ensureCheckout,
  parseLibraryId,
  resolveVersionTag,
  type CodeSearchConfig,
} from "../src/lib/code-search/checkout.js";
import { extractSymbols } from "../src/lib/code-search/indexer.js";
import { describeLicense, sanitizeSource } from "../src/lib/code-search/safety.js";
import { readLibrarySourceFile, searchLibraryCode } from "../src/lib/code-search/tools.js";
import { createCodeSearchFixture, type CodeSearchFixture } from "./fixtures/code-search-repo.js";

const LIB = "/acme/widgets";

describe("parseLibraryId", () => {
  test("reads org, repo and an optional version", () => {
    expect(parseLibraryId("/vercel/next.js")).toEqual({ org: "vercel", repo: "next.js" });
    expect(parseLibraryId("/fasterxml/jackson-databind/2.14")).toEqual({
      org: "fasterxml",
      repo: "jackson-databind",
      version: "2.14",
    });
  });

  test("rejects website libraries and malformed IDs", () => {
    expect(() => parseLibraryId("/websites/react_dev")).toThrow(/documentation website/);
    expect(() => parseLibraryId("/llmstxt/foo")).toThrow(CodeSearchError);
    expect(() => parseLibraryId("next.js")).toThrow(/Invalid library ID/);
    expect(() => parseLibraryId("/org/../etc")).toThrow(/Invalid library ID/);
    expect(() => parseLibraryId("/a/b/c/d")).toThrow(/Invalid library ID/);
  });
});

describe("resolveVersionTag", () => {
  const tags = [
    "v1.0.0",
    "v1.1.0",
    "v1.1.2",
    "v2.0.0-beta.1",
    "pyiceberg-0.11.1",
    "jackson-databind-2.14.3",
    "jackson-databind-2.14.10",
    "@tanstack/query-core@5.1.0",
  ];

  test.each([
    ["v1.1.0", "v1.1.0"],
    ["1.1.0", "v1.1.0"],
    ["1", "v1.1.2"],
    ["1.1", "v1.1.2"],
    ["v1.0", "v1.0.0"],
    ["0.11.1", "pyiceberg-0.11.1"],
    ["2.14", "jackson-databind-2.14.10"],
    ["5", "@tanstack/query-core@5.1.0"],
    ["2.0.0-beta.1", "v2.0.0-beta.1"],
  ])("%s resolves to %s", (version, expected) => {
    expect(resolveVersionTag(version, tags)).toBe(expected);
  });

  test("prefers plain tags, then tags named after the repository, in a monorepo", () => {
    const monorepo = ["react-dom@18.3.1", "react@18.3.1", "react-is@19.0.0", "scheduler@0.23.0"];
    expect(resolveVersionTag("18", monorepo, "react")).toBe("react@18.3.1");
    expect(resolveVersionTag("1", ["v1.2.0", "core@1.3.0"], "widgets")).toBe("v1.2.0");
  });

  test("does not pick a pre-release for a stable request, or a missing version", () => {
    expect(resolveVersionTag("2", ["v1.0.0", "v2.0.0-beta.1", "v2.0.0-rc.2"])).toBeUndefined();
    expect(resolveVersionTag("3.0", tags)).toBeUndefined();
    expect(resolveVersionTag("latest-ish", tags)).toBeUndefined();
  });
});

describe("extractSymbols", () => {
  test("finds declarations across languages", () => {
    const names = (file: string, source: string) =>
      extractSymbols(file, source).map((s) => `${s.kind}:${s.name}`);

    expect(
      names(
        "a.ts",
        "export function useQuery() {}\nexport interface Options {}\nexport type Id = string;\nexport const LIMIT = 1;\nconst helper = (x) => x;\nexport class Store {\n  async load(id: string): Promise<void> {\n    if (id) {\n"
      )
    ).toEqual([
      "function:useQuery",
      "interface:Options",
      "type:Id",
      "constant:LIMIT",
      "function:helper",
      "class:Store",
      "method:load",
    ]);
    expect(
      names("a.py", "class Foo:\n    async def bar(self):\n        pass\nMAX_SIZE = 3\n")
    ).toEqual(["class:Foo", "function:bar", "constant:MAX_SIZE"]);
    expect(names("a.go", "func (s *S) Run() {}\ntype S struct {}\ntype R interface {}\n")).toEqual([
      "function:Run",
      "struct:S",
      "interface:R",
    ]);
    expect(
      names("a.rs", "pub async fn fetch() {}\npub struct Conn;\npub(crate) trait Io {}\n")
    ).toEqual(["function:fetch", "struct:Conn", "trait:Io"]);
    expect(names("a.txt", "function nope() {}")).toEqual([]);
  });
});

describe("output safety", () => {
  test("shows hidden characters and redacts credentials", () => {
    expect(sanitizeSource("a\u200Bb\u202Ec")).toBe("a[U+200B]b[U+202E]c");
    expect(sanitizeSource('key = "AKIAABCDEFGHIJKLMNOP"')).toBe('key = "[REDACTED SECRET]"');
    const pem = "x\n-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----\ny";
    // Line count stays the same, so line numbers in file reads stay correct.
    expect(sanitizeSource(pem)).toBe("x\n[REDACTED SECRET]\n\n\n\ny");
  });

  test("describes a missing license as all rights reserved", () => {
    expect(describeLicense({})).toContain("all rights reserved");
    expect(describeLicense({ spdx: "MIT", file: "LICENSE" })).toBe("License: MIT (LICENSE)");
  });
});

describe("code search against a local repository", () => {
  let fixture: CodeSearchFixture;
  let config: CodeSearchConfig;

  beforeAll(() => {
    fixture = createCodeSearchFixture();
    config = { cacheDir: fixture.cacheDir, gitBaseUrl: fixture.gitBase };
  });

  afterAll(() => fixture?.cleanup());

  test("pins literal search to the requested version", async () => {
    const v10 = await searchLibraryCode(config, {
      libraryId: LIB,
      pattern: "DEFAULT_TIMEOUT =",
      version: "1.0",
    });
    expect(v10.outcome).toBe("success");
    expect(v10.text).toContain("acme/widgets at tag v1.0.0");
    expect(v10.text).toContain("export const DEFAULT_TIMEOUT = 30_000;");

    const v11 = await searchLibraryCode(config, {
      libraryId: `${LIB}/1.1`,
      pattern: "DEFAULT_TIMEOUT =",
    });
    expect(v11.text).toContain("tag v1.1.2");
    expect(v11.text).toContain("export const DEFAULT_TIMEOUT = 60_000;");
  });

  test("finds where an error message comes from and ranks library code first", async () => {
    const result = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "createclient",
    });
    expect(result.outcome).toBe("success");
    const files = [...result.text.matchAll(/^(\S+\.\w+)$/gm)].map((m) => m[1]);
    expect(files).toEqual(["src/client.ts", "test/client.test.ts", "docs/guide.md"]);

    const error = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "Request timed out after",
    });
    expect(error.text).toMatch(/src\/client\.ts\n\s+10: /);
  });

  test("supports regex mode and path filters", async () => {
    const regex = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1",
      pattern: "def (get_timeout|build_widget)",
      mode: "regex",
    });
    expect(regex.text).toContain("widgets/core.py");
    expect(regex.text).toContain("2 matches in 1 files");

    const filtered = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1",
      pattern: "timeout",
      path: "*.py",
    });
    expect(filtered.text).toContain("widgets/core.py");
    expect(filtered.text).not.toContain("src/client.ts");

    const directory = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1",
      pattern: "timeout",
      path: "src",
      maxResults: 2,
    });
    expect(directory.text).toContain("2 matches in 1 files");
  });

  test("finds symbol definitions and reports a symbol missing at a version", async () => {
    const found = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.1.2",
      pattern: "createClient",
      mode: "symbol",
    });
    expect(found.outcome).toBe("success");
    expect(found.text).toContain("src/client.ts:8 [function] createClient");

    const method = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.1.2",
      pattern: "WidgetClient.send",
      mode: "symbol",
    });
    expect(method.text).toContain("[method] send");

    const renamed = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "2.0.0-beta.1",
      pattern: "createClient",
      mode: "symbol",
    });
    expect(renamed.outcome).toBe("not_found");
    expect(renamed.text).toContain("No definition named 'createClient'");
  });

  test("uses the default branch when no version is given", async () => {
    const result = await searchLibraryCode(config, {
      libraryId: LIB,
      pattern: "makeClient",
      mode: "symbol",
    });
    expect(result.text).toContain("at default branch");
    expect(result.text).toContain("[function] makeClient");
  });

  test("returns clear errors", async () => {
    const version = await searchLibraryCode(config, {
      libraryId: LIB,
      pattern: "x",
      version: "9.9",
    });
    expect(version.outcome).toBe("error");
    expect(version.text).toContain("No tag matches version '9.9'");
    expect(version.text).toContain("v1.1.2");

    const regex = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1",
      pattern: "(",
      mode: "regex",
    });
    expect(regex.outcome).toBe("error");
    expect(regex.text).toMatch(/Invalid search pattern/);

    const missing = await searchLibraryCode(config, { libraryId: "/acme/missing", pattern: "x" });
    expect(missing.outcome).toBe("error");
    expect(missing.text).toContain("Could not clone acme/missing");

    const website = await searchLibraryCode(config, { libraryId: "/websites/acme", pattern: "x" });
    expect(website.text).toContain("documentation website");
  });

  test("reuses a cached checkout instead of cloning again", async () => {
    const first = await ensureCheckout(config, LIB, "1.0.0");
    const marker = path.join(first.root, "cache-marker");
    writeFileSync(marker, "kept");
    const second = await ensureCheckout(config, LIB, "v1.0.0");
    expect(second.root).toBe(first.root);
    expect(existsSync(marker)).toBe(true);

    await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "Widget",
      mode: "symbol",
    });
    expect(existsSync(path.join(first.dir, "index.json"))).toBe(true);
  });

  test("reports provenance, license and how the version matched", async () => {
    const approximate = await searchLibraryCode(config, {
      libraryId: LIB,
      pattern: "DEFAULT_TIMEOUT",
      version: "1.0",
    });
    expect(approximate.text).toMatch(/Source: file:\/\/\S+\/acme\/widgets @ [0-9a-f]{40}/);
    expect(approximate.text).toContain("License: MIT (LICENSE)");
    expect(approximate.text).toContain("'1.0' matched tag v1.0.0 by version prefix");
    expect(approximate.text).toContain("<library-source>");
    expect(approximate.text).toMatch(/\[~\d+ tokens\]$/);

    const exact = await searchLibraryCode(config, {
      libraryId: LIB,
      pattern: "DEFAULT_TIMEOUT",
      version: "1.0.0",
    });
    expect(exact.text).not.toContain("by version prefix");
  });

  test("hides agent instruction files and cleans returned source", async () => {
    const hidden = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "ignore previous",
    });
    expect(hidden.text).toContain("[U+200B]");
    expect(hidden.text).not.toContain("\u200B");

    const file = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "src/hidden.ts",
    });
    expect(file.text).toContain("[REDACTED SECRET]");
    expect(file.text).not.toContain("AKIAABCDEFGHIJKLMNOP");

    const agents = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "debug mode",
    });
    expect(agents.outcome).toBe("not_found");
  });

  test("counts matches, lists files and pages through results", async () => {
    const count = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "timeout",
      output: "count",
    });
    expect(count.text).toMatch(/\d+ matching lines in \d+ files\./);
    expect(count.text).not.toContain("<library-source>");

    const files = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "timeout",
      output: "files",
    });
    expect(files.text).toMatch(/^src\/client\.ts \(\d+\)$/m);

    const first = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "// line",
      path: "src/long.ts",
      maxResults: 5,
    });
    expect(first.text).toContain("results 1-5");
    expect(first.text).toContain("call again with offset 5");

    const second = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "// line",
      path: "src/long.ts",
      maxResults: 5,
      offset: 5,
    });
    expect(second.text).toContain("results 6-10");
    expect(second.text).toContain("// line 6");
  });

  test("reads line ranges, lists directories and suggests paths", async () => {
    const range = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "src/client.ts",
      startLine: 5,
      endLine: 7,
    });
    expect(range.outcome).toBe("success");
    expect(range.text).toContain("File: src/client.ts (lines 5-7 of");
    expect(range.text).toContain("    5  export const DEFAULT_TIMEOUT = 30_000;");
    expect(range.text).not.toContain("    8  ");

    const long = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "src/long.ts",
    });
    expect(long.text).toContain("lines 1-200 of 450");
    expect(long.text).toContain("Call again with startLine 201");

    const capped = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "src/long.ts",
      startLine: 1,
      endLine: 450,
    });
    expect(capped.text).toContain("lines 1-400 of 450");

    const listing = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "/",
    });
    expect(listing.text).toContain("Directory: .");
    expect(listing.text).toContain("src/");
    expect(listing.text).not.toContain(".git");

    const typo = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "lib/client.ts",
    });
    expect(typo.outcome).toBe("error");
    expect(typo.text).toContain("Did you mean: src/client.ts");
  });

  test("checks out symlinks as plain files", async () => {
    const result = await readLibrarySourceFile(config, {
      libraryId: LIB,
      version: "1.0.0",
      path: "escape",
    });
    expect(result.outcome).toBe("success");
    expect(result.text).toContain("1  /etc");
  });

  test("never reads outside the checkout", async () => {
    for (const target of ["../../../../etc/hosts", "escape/hosts", ".git/config", "/etc/hosts"]) {
      const result = await readLibrarySourceFile(config, {
        libraryId: LIB,
        version: "1.0.0",
        path: target,
      });
      expect(result.outcome, target).toBe("error");
      expect(result.text, target).toMatch(
        /outside the repository|not a source file|does not exist/
      );
    }
  });
});

describe("cache limits and slow clones", () => {
  let fixture: CodeSearchFixture;

  beforeAll(() => {
    fixture = createCodeSearchFixture();
  });

  afterAll(() => fixture?.cleanup());

  test("evicts the least recently used checkout above the size limit", async () => {
    const config: CodeSearchConfig = {
      cacheDir: path.join(fixture.cacheDir, "small"),
      gitBaseUrl: fixture.gitBase,
      maxCacheBytes: 1,
    };
    const older = await ensureCheckout(config, LIB, "1.0.0");
    const meta = JSON.parse(readFileSync(path.join(older.dir, "meta.json"), "utf8"));
    expect(meta.bytes).toBeGreaterThan(0);

    const newer = await ensureCheckout(config, LIB, "1.1.0");
    expect(existsSync(older.dir)).toBe(false);
    expect(existsSync(newer.root)).toBe(true);
  });

  test("asks the agent to retry while a clone is still running", async () => {
    const config: CodeSearchConfig = {
      cacheDir: path.join(fixture.cacheDir, "slow"),
      gitBaseUrl: fixture.gitBase,
      cloneWaitMs: 1,
    };
    const pending = await searchLibraryCode(config, {
      libraryId: LIB,
      version: "1.0.0",
      pattern: "createClient",
    });
    expect(pending.retryable).toBe(true);
    expect(pending.text).toContain("still downloading");

    // The clone continues in the background; a call without a wait limit reuses it.
    const ready = await searchLibraryCode(
      { ...config, cloneWaitMs: 0 },
      { libraryId: LIB, version: "1.0.0", pattern: "createClient" }
    );
    expect(ready.outcome).toBe("success");
  });
});
