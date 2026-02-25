import { describe, test, expect, vi } from "vitest";
import { SearchLibraryCommand } from "./index";
import { Context7Error } from "@error";
import type { Requester } from "@http";

function mockRequester(result: unknown): Requester {
  return {
    request: vi.fn().mockResolvedValue({ result }),
  };
}

describe("SearchLibraryCommand — defensive parsing", () => {
  test("should handle response with missing results field", async () => {
    const requester = mockRequester({});

    const command = new SearchLibraryCommand("build UI", "react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("should handle response with null results", async () => {
    const requester = mockRequester({ results: null });

    const command = new SearchLibraryCommand("build UI", "react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("should handle response with results not being an array", async () => {
    const requester = mockRequester({ results: "not-an-array" });

    const command = new SearchLibraryCommand("build UI", "react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("should handle undefined result", async () => {
    const requester = mockRequester(undefined);

    const command = new SearchLibraryCommand("build UI", "react");
    await expect(command.exec(requester)).rejects.toThrow(Context7Error);
  });

  test("should return empty text for txt type with missing results", async () => {
    const requester = mockRequester({});

    const command = new SearchLibraryCommand("build UI", "react", { type: "txt" });
    const result = await command.exec(requester);

    expect(typeof result).toBe("string");
    expect(result).toBe("No libraries found.");
  });

  test("should throw on empty query", () => {
    expect(() => new SearchLibraryCommand("", "react")).toThrow(Context7Error);
  });

  test("should throw on empty libraryName", () => {
    expect(() => new SearchLibraryCommand("build UI", "")).toThrow(Context7Error);
  });

  test("should format valid results correctly", async () => {
    const requester = mockRequester({
      results: [
        {
          id: "/facebook/react",
          title: "React",
          description: "A JavaScript library for building user interfaces",
          totalSnippets: 150,
          trustScore: 9,
          benchmarkScore: 85,
          versions: ["v18.3.0", "v19.0.0"],
        },
      ],
    });

    const command = new SearchLibraryCommand("build UI", "react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);

    const library = result[0] as {
      id: string;
      name: string;
      description: string;
      totalSnippets: number;
      trustScore: number;
      benchmarkScore: number;
      versions?: string[];
    };
    expect(library.id).toBe("/facebook/react");
    expect(library.name).toBe("React");
    expect(library.totalSnippets).toBe(150);
    expect(library.trustScore).toBe(9);
    expect(library.benchmarkScore).toBe(85);
    expect(library.versions).toEqual(["v18.3.0", "v19.0.0"]);
  });
});
