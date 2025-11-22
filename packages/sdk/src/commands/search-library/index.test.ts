import { describe, test } from "node:test";
import assert from "node:assert";
import { SearchLibraryCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";

const httpClient = newHttpClient();

describe("SearchLibraryCommand", () => {
  test("should search for a library", async () => {
    const command = new SearchLibraryCommand("react", { limit: 5 });
    const result = await command.exec(httpClient);

    assert(result !== undefined);
    assert(result.results !== undefined);
    assert(Array.isArray(result.results));
    assert(result.results.length > 0);
    assert(result.results.length <= 5);
  });

  test("should search for a library using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.searchLibrary("react", { limit: 5 });

    assert(result !== undefined);
    assert(result.results !== undefined);
    assert(Array.isArray(result.results));
    assert(result.results.length > 0);
    assert(result.results.length <= 5);
  });
});
