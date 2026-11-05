import { describe, expect, test } from "vitest";
import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";
import { envelopeClientInfo, formatSearchResults } from "../src/lib/utils.js";
import type { SearchResult } from "../src/lib/types.js";

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

describe("formatSearchResults", () => {
  test("keeps the filter notice when no libraries match", () => {
    expect(formatSearchResults({ results: [], searchFilterApplied: true })).toBe(
      `${filterNotice}\n\nNo documentation libraries found matching your query.`
    );
  });

  test.each([false, undefined])("omits the filter notice when the flag is %s", (flag) => {
    expect(formatSearchResults({ results: [], searchFilterApplied: flag })).toBe(
      "No documentation libraries found matching your query."
    );
  });

  test("keeps populated search results after the filter notice", () => {
    const unfiltered = formatSearchResults({ results: [searchResult] });
    expect(formatSearchResults({ results: [searchResult], searchFilterApplied: true })).toBe(
      `${filterNotice}\n\n${unfiltered}`
    );
    expect(unfiltered).toContain("- Context7-compatible library ID: /vercel/next.js");
  });
});

// The request _meta envelope is untyped as of SDK 2.0.0, so
// envelopeClientInfo's probing of it is not compile-checked. These tests pin
// the expected shape so an SDK bump that changes it fails loudly.
describe("envelopeClientInfo", () => {
  test("extracts ide/version from a client-info envelope entry", () => {
    const envelope = {
      [CLIENT_INFO_META_KEY]: { name: "cursor", version: "2.2.44" },
    };
    expect(envelopeClientInfo(envelope)).toEqual({ ide: "cursor", version: "2.2.44" });
  });

  test("returns undefined when the envelope is missing or lacks client info", () => {
    expect(envelopeClientInfo(undefined)).toBeUndefined();
    expect(envelopeClientInfo({})).toBeUndefined();
  });
});
