import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSearchResults } from "../lib/format";
import { resolveLibraryIdTool } from "../lib/tools/resolve-library-id";
import type { SearchResponse, SearchResult } from "../lib/types";

const searchResult: SearchResult = {
  id: "/vercel/next.js",
  title: "Next.js",
  description: "The React Framework",
  branch: "main",
  lastUpdateDate: "2026-01-01",
  state: "finalized",
  totalTokens: 100,
  totalSnippets: 10,
};

const filterNotice =
  "**Note:** Your results only include libraries matching your teamspace's library filters. To adjust quality thresholds or blocked libraries, update your filters at https://context7.com/dashboard?tab=policies";
const noMatch = "No documentation libraries found matching your query.";

describe("formatSearchResults", () => {
  it("keeps the filter notice when no libraries match", () => {
    expect(formatSearchResults({ results: [], searchFilterApplied: true })).toBe(
      `${filterNotice}\n\n${noMatch}`
    );
  });

  it.each([false, undefined])("omits the filter notice when the flag is %s", (flag) => {
    expect(formatSearchResults({ results: [], searchFilterApplied: flag })).toBe(noMatch);
  });

  it("keeps populated search results after the filter notice", () => {
    const unfiltered = formatSearchResults({ results: [searchResult] });
    expect(formatSearchResults({ results: [searchResult], searchFilterApplied: true })).toBe(
      `${filterNotice}\n\n${unfiltered}`
    );
  });
});

describe("resolve-library-id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function resolve(response: Response): Promise<string> {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await resolveLibraryIdTool.execute(
      "test-call",
      { query: "routing", libraryName: "Next.js" },
      undefined,
      undefined,
      {} as never
    );
    return (result.content[0] as { text: string }).text;
  }

  it("keeps the filter notice when no libraries match", async () => {
    const body: SearchResponse = { results: [], searchFilterApplied: true };
    expect(await resolve(Response.json(body))).toBe(`${filterNotice}\n\n${noMatch}`);
  });

  it("returns the no-match line for an unfiltered empty search", async () => {
    expect(await resolve(Response.json({ results: [] }))).toBe(noMatch);
  });

  it("returns the API error ahead of the filter notice", async () => {
    const response = Response.json({ message: "Invalid API key." }, { status: 401 });
    expect(await resolve(response)).toBe("Invalid API key.");
  });

  it("prefixes populated results with Available Libraries", async () => {
    const body: SearchResponse = { results: [searchResult], searchFilterApplied: true };
    expect(await resolve(Response.json(body))).toBe(
      `Available Libraries:\n\n${formatSearchResults(body)}`
    );
  });
});
