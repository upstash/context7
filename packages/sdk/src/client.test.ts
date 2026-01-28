import { describe, test, expect } from "vitest";
import { Context7 } from "./client";
import { Context7Error } from "@error";

describe("Context7 Client", () => {
  const apiKey = process.env.CONTEXT7_API_KEY || process.env.API_KEY!;

  describe("constructor", () => {
    test("should create client with API key", () => {
      const client = new Context7({ apiKey });
      expect(client).toBeDefined();
    });

    test("should create client from environment variables", () => {
      const client = new Context7();
      expect(client).toBeDefined();
    });

    test("should throw error when API key is missing", () => {
      const originalEnv = process.env.CONTEXT7_API_KEY;
      const originalApiKey = process.env.API_KEY;

      delete process.env.CONTEXT7_API_KEY;
      delete process.env.API_KEY;

      expect(() => new Context7({ apiKey: "" })).toThrow(Context7Error);
      expect(() => new Context7({})).toThrow(Context7Error);
      expect(() => new Context7()).toThrow("API key is required");

      if (originalEnv) process.env.CONTEXT7_API_KEY = originalEnv;
      if (originalApiKey) process.env.API_KEY = originalApiKey;
    });

    test("should prefer config API key over environment variable", () => {
      const customApiKey = "ctx7sk-custom-key";
      const client = new Context7({ apiKey: customApiKey });
      expect(client).toBeDefined();
    });
  });

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
    });
  });

  describe("getContext - JSON format (default)", () => {
    const client = new Context7({ apiKey });

    test("should get context as Documentation array (default)", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react");

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should get context with explicit json type", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "json",
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    test("should have correct Documentation structure", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
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
      const result = await client.getContext("How to use hooks", "/facebook/react", {
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

  describe("error handling", () => {
    const client = new Context7({ apiKey });

    test("should handle invalid library ID gracefully", async () => {
      await expect(client.getContext("test query", "/nonexistent/library")).rejects.toThrow();
    });

    test("should handle invalid search query", async () => {
      await expect(client.searchLibrary("", "")).rejects.toThrow(Context7Error);
    });
  });

  describe("type inference", () => {
    const client = new Context7({ apiKey });

    test("should infer Documentation[] for default (json) format", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react");

      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("title");
      expect(result[0]).toHaveProperty("content");
      expect(result[0]).toHaveProperty("source");
    });

    test("should infer string type for txt format", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "txt",
      });

      expect(typeof result).toBe("string");
    });
  });
});
