import { describe, expect, test } from "vitest";
import { codeArgs, looksLikeVersion, readArgs } from "../utils/codeArgs.js";

// The cases come from rejected commands of agents in the code tools benchmark.

describe("codeArgs", () => {
  test("keeps a plain command as it is", () => {
    expect(codeArgs("/acme/widgets", "createClient", [], {})).toEqual({
      ok: true,
      libraryId: "/acme/widgets",
      pattern: "createClient",
      path: undefined,
      glob: undefined,
    });
  });

  test("takes one path after the pattern as --path, like rg PATTERN PATH", () => {
    const args = codeArgs("/acme/widgets", "createClient", ["src/client.ts"], {});
    expect(args).toMatchObject({ ok: true, pattern: "createClient", path: "src/client.ts" });
  });

  test("takes several paths as globs: a file as it is, a folder with /**", () => {
    const args = codeArgs("/acme/widgets", "MaxStreams", ["envconfig/", "server/", "cmd/main.go"], {
      glob: ["!**/*_test.go"],
    });
    expect(args).toMatchObject({
      ok: true,
      glob: ["!**/*_test.go", "envconfig/**", "server/**", "cmd/main.go"],
    });
  });

  test("names the quoted command for an unquoted phrase instead of guessing", () => {
    const args = codeArgs("/acme/widgets", "requires", ["approval,", "but", "policy"], {});
    expect(args).toMatchObject({ ok: false });
    if (!args.ok) {
      expect(args.error).toContain("split into 4 arguments");
      expect(args.hint).toContain('ctx7 code /acme/widgets "requires approval, but policy" -F');
    }
  });

  test("does not guess that a bare word is a folder", () => {
    expect(codeArgs("/acme/widgets", "MaxStreams", ["envconfig"], {})).toMatchObject({ ok: false });
  });

  test("names the versioned command for a version written as the pattern", () => {
    const args = codeArgs("/kubernetes/kubernetes", "v1.36.6", ["KUBECTL_KYAML"], {});
    expect(args).toMatchObject({ ok: false });
    if (!args.ok) expect(args.hint).toContain("ctx7 code /kubernetes/kubernetes/v1.36.6");
  });

  test("accepts docs-style --library and --query", () => {
    expect(
      codeArgs("getLimitBurstMultiplier", undefined, [], { library: "/traefik/traefik" })
    ).toMatchObject({
      ok: true,
      libraryId: "/traefik/traefik",
      pattern: "getLimitBurstMultiplier",
    });
    expect(
      codeArgs("/traefik/traefik", undefined, [], { query: "getLimitBurstMultiplier" })
    ).toMatchObject({
      ok: true,
      pattern: "getLimitBurstMultiplier",
    });
  });

  test("asks for the library ID with an example when it is missing", () => {
    expect(codeArgs(undefined, undefined, [], {})).toMatchObject({ ok: false });
  });
});

describe("looksLikeVersion", () => {
  test.each(["v1.36.6", "26.8.2", "REL_18_0", "rust-v0.165.0", "n8n@2.32.5", "4.7.2-stable"])(
    "%s is a version",
    (value) => expect(looksLikeVersion(value)).toBe(true)
  );
  test.each(["createClient", "Client.send", "worker"])("%s is not a version", (value) =>
    expect(looksLikeVersion(value)).toBe(false)
  );
});

describe("readArgs", () => {
  test("reads a file range or a symbol", () => {
    expect(readArgs("/acme/widgets", "src/a.ts#L1-L40")).toEqual({
      ok: true,
      libraryId: "/acme/widgets",
      path: "src/a.ts#L1-L40",
    });
    expect(readArgs("/acme/widgets", "Client.send")).toEqual({
      ok: true,
      libraryId: "/acme/widgets",
      symbol: "Client.send",
    });
  });

  test("splits a target copied together with its library ID", () => {
    expect(readArgs("/ollama/ollama/create/phonon.go#L1-L120", undefined)).toEqual({
      ok: true,
      libraryId: "/ollama/ollama",
      path: "create/phonon.go#L1-L120",
    });
    expect(readArgs("/ollama/ollama/v0.40.11/envconfig/config.go#L280-L290", undefined)).toEqual({
      ok: true,
      libraryId: "/ollama/ollama/v0.40.11",
      path: "envconfig/config.go#L280-L290",
    });
  });

  test("asks for the library ID when only a file is given", () => {
    const args = readArgs("src/backend/postmaster/postmaster.c#L4430-L4520", undefined);
    expect(args).toMatchObject({ ok: false });
    if (!args.ok)
      expect(args.hint).toBe(
        "Example: ctx7 read /owner/repo src/backend/postmaster/postmaster.c#L4430-L4520"
      );
  });
});
