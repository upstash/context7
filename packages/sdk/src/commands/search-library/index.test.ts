import { describe, test, expect } from "vitest";
import { SearchLibraryCommand } from "./index";
import type { Requester } from "@http";
import { Context7Error } from "@error";

function requesterWith(result: unknown): Requester {
  return {
    request: async <TResult>() => ({ result: result as TResult }),
  };
}

const apiResult = {
  results: [
    {
      id: "/facebook/react",
      title: "React",
      description: "A UI library",
      totalSnippets: 42,
      trustScore: 10,
      benchmarkScore: 95,
      versions: ["v19"],
    },
  ],
};

describe("SearchLibraryCommand", () => {
  test("maps an API response to libraries", async () => {
    const command = new SearchLibraryCommand("I need to build a UI", "react");

    await expect(command.exec(requesterWith(apiResult))).resolves.toEqual([
      {
        id: "/facebook/react",
        name: "React",
        description: "A UI library",
        totalSnippets: 42,
        trustScore: 10,
        benchmarkScore: 95,
        versions: ["v19"],
      },
    ]);
  });

  test("formats a text response locally", async () => {
    const command = new SearchLibraryCommand("I need to build a UI", "react", {
      type: "txt",
    });

    const result = await command.exec(requesterWith(apiResult));

    expect(result).toContain("Context7-compatible library ID: /facebook/react");
    expect(result).toContain("Trust Score: High");
  });

  test("rejects missing inputs without making a request", () => {
    expect(() => new SearchLibraryCommand("", "react")).toThrow(Context7Error);
    expect(() => new SearchLibraryCommand("query", "")).toThrow(Context7Error);
  });
});
