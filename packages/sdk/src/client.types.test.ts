import { describe, expectTypeOf, test } from "vitest";
import {
  Context7,
  type Documentation,
  type GetContextOptions,
  type Library,
  type SearchLibraryOptions,
  type SearchResponse,
  type SearchOptions,
} from "./client";

function searchWithOptions(client: Context7, options: SearchLibraryOptions) {
  return client.searchLibrary("query", "react", options);
}

function getContextWithOptions(client: Context7, options: GetContextOptions) {
  return client.getContext("query", "/react/react", options);
}

function searchWithOptionalOptions(client: Context7, options: SearchLibraryOptions | undefined) {
  return client.searchLibrary("query", "react", options);
}

function getContextWithOptionalOptions(client: Context7, options: GetContextOptions | undefined) {
  return client.getContext("query", "/react/react", options);
}

function searchWithDefaultOptions(client: Context7) {
  return client.searchLibrary("query", "react", {});
}

function getContextWithDefaultOptions(client: Context7) {
  return client.getContext("query", "/react/react", {});
}

function documentationSearchWithOptions(client: Context7, options: SearchOptions) {
  return client.search("query", options);
}

function documentationSearchWithOptionalOptions(
  client: Context7,
  options: SearchOptions | undefined
) {
  return client.search("query", options);
}

function documentationSearchWithDefaultOptions(client: Context7) {
  return client.search("query");
}

function documentationSearchWithJsonOptions(client: Context7) {
  return client.search("query", { type: "json" });
}

describe("Context7 Client types", () => {
  test("returns a union when the search response type is determined at runtime", () => {
    expectTypeOf(searchWithOptions).returns.toEqualTypeOf<Promise<Library[] | string>>();
  });

  test("returns a union when the context response type is determined at runtime", () => {
    expectTypeOf(getContextWithOptions).returns.toEqualTypeOf<Promise<Documentation[] | string>>();
  });

  test("accepts optional response options", () => {
    expectTypeOf(searchWithOptionalOptions).returns.toEqualTypeOf<Promise<Library[] | string>>();
    expectTypeOf(getContextWithOptionalOptions).returns.toEqualTypeOf<
      Promise<Documentation[] | string>
    >();
  });

  test("preserves JSON return types for empty options", () => {
    expectTypeOf(searchWithDefaultOptions).returns.toEqualTypeOf<Promise<Library[]>>();
    expectTypeOf(getContextWithDefaultOptions).returns.toEqualTypeOf<Promise<Documentation[]>>();
  });

  test("types search responses from the requested format", () => {
    expectTypeOf(documentationSearchWithOptions).returns.toEqualTypeOf<
      Promise<SearchResponse | string>
    >();
    expectTypeOf(documentationSearchWithOptionalOptions).returns.toEqualTypeOf<
      Promise<SearchResponse | string>
    >();
    expectTypeOf(documentationSearchWithDefaultOptions).returns.toEqualTypeOf<
      Promise<SearchResponse>
    >();
    expectTypeOf(documentationSearchWithJsonOptions).returns.toEqualTypeOf<
      Promise<SearchResponse>
    >();
  });
});
