import { describe, test, expect } from "vitest";
import { Context7 } from "./client";

describe("Context7 Client integration", () => {
  const apiKey = process.env.CONTEXT7_API_KEY!;

  describe("searchLibrary", () => {
    const client = new Context7({ apiKey });

    test("should search for libraries and return array directly", async () => {
      const result = await client.searchLibrary("I need to build a UI", "react");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should return Library objects with all fields", async () => {
      const result = await client.searchLibrary("I want to use TypeScript", "typescript");

      expect(result.length).toBeGreaterThan(0);
      const library = result[0];

      expect(library).toHaveProperty("id");
      expect(library).toHaveProperty("name");
      expect(library).toHaveProperty("description");
      expect(library).toHaveProperty("totalSnippets");
      expect(library).toHaveProperty("trustScore");
      expect(library).toHaveProperty("benchmarkScore");
    });

    test("should search with different queries", async () => {
      const queries = ["vue", "express", "next"];

      for (const query of queries) {
        const result = await client.searchLibrary(`I want to use ${query}`, query);
        expect(result.length).toBeGreaterThan(0);
      }
    }, 15000);
  });

  describe("getContext - JSON format (default)", () => {
    const client = new Context7({ apiKey });

    test("should get context as Documentation array (default)", async () => {
      const result = await client.getContext("How to use hooks", "/react/react");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should get context with explicit json type", async () => {
      const result = await client.getContext("How to use hooks", "/react/react", {
        type: "json",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should have correct Documentation structure", async () => {
      const result = await client.getContext("How to use hooks", "/react/react", {
        type: "json",
      });

      expect(result.length).toBeGreaterThan(0);
      const doc = result[0];
      expect(doc).toHaveProperty("title");
      expect(doc).toHaveProperty("content");
      expect(doc).toHaveProperty("source");
      expect(typeof doc.title).toBe("string");
      expect(typeof doc.content).toBe("string");
      expect(typeof doc.source).toBe("string");
    });
  });

  describe("getContext - text format", () => {
    const client = new Context7({ apiKey });

    test("should get context as text string with type: txt", async () => {
      const result = await client.getContext("How to use hooks", "/react/react", {
        type: "txt",
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getContext - different libraries", () => {
    const client = new Context7({ apiKey });

    test("should get context for Vue", async () => {
      const result = await client.getContext("How to create components", "/vuejs/core");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should get context for Express", async () => {
      const result = await client.getContext("How to create routes", "/expressjs/express");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("live error handling", () => {
    const client = new Context7({ apiKey });

    test("should handle invalid library ID gracefully", async () => {
      await expect(client.getContext("test query", "/nonexistent/library")).rejects.toThrow();
    });
  });
});
