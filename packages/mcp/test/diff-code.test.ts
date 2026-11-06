import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchLibraryDiff } from "../src/lib/api.js";
import { diffCodeInputSchema } from "../src/lib/diff-code-tool.js";

describe("diff-code input", () => {
  test("clamps numbers into their ranges and reads numbers sent as strings", () => {
    const parsed = diffCodeInputSchema.parse({
      libraryId: "/colinhacks/zod",
      base: "v3.23.8",
      context: 25,
      head_limit: "900",
      max_patch_bytes: 10,
      offset: -4,
    });
    expect(parsed).toMatchObject({
      context: 10,
      head_limit: 500,
      max_patch_bytes: 1024,
      offset: 0,
    });
    expect(
      diffCodeInputSchema.parse({ libraryId: "/a/b", base: "v1", max_patch_bytes: 1e9 })
    ).toMatchObject({ max_patch_bytes: 262_144 });
  });

  test("rewrites aliases agents send by habit", () => {
    expect(
      diffCodeInputSchema.parse({
        libraryID: "/colinhacks/zod",
        from: "v3.23.8",
        to: "v4.0.0",
        onlyBreaking: true,
        limit: 20,
      })
    ).toMatchObject({
      libraryId: "/colinhacks/zod",
      base: "v3.23.8",
      version: "v4.0.0",
      only_breaking: true,
      head_limit: 20,
    });
  });

  test("needs base and a known view", () => {
    expect(diffCodeInputSchema.safeParse({ libraryId: "/a/b" }).success).toBe(false);
    expect(diffCodeInputSchema.safeParse({ libraryId: "/a/b", base: " " }).success).toBe(false);
    expect(
      diffCodeInputSchema.safeParse({ libraryId: "/a/b", base: "v1", view: "unified" }).success
    ).toBe(false);
  });
});

describe("fetchLibraryDiff", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(response: Response) {
    const fetchMock = vi.fn(async (_url: URL | string) => response);
    vi.stubGlobal("fetch", fetchMock);
    return () => new URL(String(fetchMock.mock.calls[0][0]));
  }

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });

  test("sends the arguments as snake_case query parameters with format=txt", async () => {
    const sentUrl = stubFetch(new Response("diff text", { status: 200 }));
    const result = await fetchLibraryDiff({
      libraryId: "/colinhacks/zod",
      base: "/colinhacks/zod/v3.23.8",
      version: "/colinhacks/zod/v4.0.0",
      view: "patch",
      symbol: "ZodString.email",
      grep: "email",
      side: "added",
      ignore_case: true,
      glob: ["*.ts", "!**/test/**"],
      scope: "repo",
      only_breaking: true,
      context: 0,
      max_patch_bytes: 4096,
      offset: 20,
    });
    expect(result).toEqual({ data: "diff text", outcome: "success" });
    const url = sentUrl();
    expect(url.pathname).toMatch(/\/v2\/code\/diff$/);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      libraryId: "/colinhacks/zod",
      base: "v3.23.8",
      version: "v4.0.0",
      view: "patch",
      symbol: "ZodString.email",
      grep: "email",
      side: "added",
      ignore_case: "true",
      scope: "repo",
      only_breaking: "true",
      context: "0",
      max_patch_bytes: "4096",
      offset: "20",
      format: "txt",
    });
    expect(url.searchParams.getAll("glob")).toEqual(["*.ts", "!**/test/**"]);
    expect(url.searchParams.has("fixed_strings")).toBe(false);
    expect(url.searchParams.has("include_private")).toBe(false);
  });

  test("preserves a backend pagination offset above 10000", () => {
    expect(
      diffCodeInputSchema.parse({ libraryId: "/colinhacks/zod", base: "v3", offset: 10500 }).offset
    ).toBe(10500);
  });

  test("answers 202 as a normal result with the wait time", async () => {
    stubFetch(
      json(202, {
        error: "indexing",
        message: "v4.0.0 of /colinhacks/zod is being indexed.",
        retryAfter: 40,
        base: { state: "ready" },
        version: { state: "indexing" },
      })
    );
    const result = await fetchLibraryDiff({ libraryId: "/colinhacks/zod", base: "v3.23.8" });
    expect(result.outcome).toBe("preparing");
    expect(result.data).toMatch(/being indexed.*Call diff-code again.*40 seconds/s);
  });

  test("adds the next step for each error code", async () => {
    const cases: [Response, RegExp][] = [
      [new Response("Not Found", { status: 404 }), /not available now \(HTTP 404\)/],
      [
        json(404, { error: "not_found", message: "Unknown route" }),
        /not available now \(HTTP 404\)/,
      ],
      [
        json(400, { error: "validation_error", message: "symbol is not valid with view stat." }),
        /not valid with view stat\. Fix the arguments/,
      ],
      [
        json(413, { error: "too_many_files", message: "2,400 files changed." }),
        /2,400 files changed\. .*path, glob or symbol.*name-status/,
      ],
      [
        json(503, { error: "index_failed", message: "Tag v0 could not be indexed." }),
        /could not be indexed\. .*base and version/,
      ],
      [
        json(404, {
          error: "version_not_found",
          message: "Version v9 of /colinhacks/zod is unknown.",
        }),
        /is unknown\. Get the library ID from resolve-library-id/,
      ],
      [
        new Response("<html>Bad Gateway</html>", { status: 502 }),
        /not available now \(HTTP 502\).*answer from query-docs/,
      ],
    ];
    for (const [response, expected] of cases) {
      stubFetch(response);
      const result = await fetchLibraryDiff({ libraryId: "/colinhacks/zod", base: "v3.23.8" });
      expect(result.outcome).toBe("error");
      expect(result.data).toMatch(expected);
      vi.unstubAllGlobals();
    }
  });

  test("reports a network error without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      })
    );
    const result = await fetchLibraryDiff({ libraryId: "/colinhacks/zod", base: "v3.23.8" });
    expect(result.outcome).toBe("error");
    expect(result.data).toContain("ECONNREFUSED");
  });
});
