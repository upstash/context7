import { describe, test, expect } from "vitest";
import { SearchLibraryCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";

const httpClient = newHttpClient();

describe("SearchLibraryCommand", () => {
  test("should search for a library", async () => {
    const command = new SearchLibraryCommand("react");
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  test("should search for a library using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.searchLibrary("react");

    expect(result).toBeDefined();
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });
});
