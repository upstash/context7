import { describe, test, expect } from "vitest";
import { SearchLibraryCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";

const httpClient = newHttpClient();

describe("SearchLibraryCommand", () => {
  test("should search for a library", async () => {
    const command = new SearchLibraryCommand("I need to build a UI", "react");
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const library = result[0];
    expect(library).toHaveProperty("id");
    expect(library).toHaveProperty("name");
    expect(library).toHaveProperty("description");
    expect(library).toHaveProperty("totalSnippets");
    expect(library).toHaveProperty("trustScore");
    expect(library).toHaveProperty("benchmarkScore");
  });

  test("should search for a library using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.searchLibrary("I need to build a UI", "react");

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const library = result[0];
    expect(library).toHaveProperty("id");
    expect(library).toHaveProperty("name");
    expect(library).toHaveProperty("description");
    expect(library).toHaveProperty("totalSnippets");
    expect(library).toHaveProperty("trustScore");
    expect(library).toHaveProperty("benchmarkScore");
  });
});
