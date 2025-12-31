import { describe, test, expect } from "vitest";
import { Context7 } from "./client";
import { Context7Error } from "@error";
import type { ContextJsonResponse } from "@commands/types";

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

    test("should search for libraries", async () => {
      const result = await client.searchLibrary("I need to build a UI", "react");

      expect(result).toBeDefined();
      expect(result.results).toBeDefined();
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    });

    test("should return results with simplified Library structure", async () => {
      const result = await client.searchLibrary("I want to use TypeScript", "typescript");

      expect(result.results.length).toBeGreaterThan(0);
      const library = result.results[0];

      // Simplified Library type
      expect(library).toHaveProperty("id");
      expect(library).toHaveProperty("name");
      expect(library).toHaveProperty("description");
    });

    test("should search with different queries", async () => {
      const queries = ["vue", "express", "next"];

      for (const query of queries) {
        const result = await client.searchLibrary(`I want to use ${query}`, query);
        expect(result.results.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getContext - text format", () => {
    const client = new Context7({ apiKey });

    test("should get context as text (default)", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("data");
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    });

    test("should get context with explicit txt type", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "txt",
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty("data");
      expect(typeof result.data).toBe("string");
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe("getContext - JSON format", () => {
    const client = new Context7({ apiKey });

    test("should get context as JSON with simplified types", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "json",
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe("object");

      const jsonResult = result as ContextJsonResponse;
      expect(jsonResult.library).toBeDefined();
      expect(jsonResult.docs).toBeDefined();
      expect(Array.isArray(jsonResult.docs)).toBe(true);
    });

    test("should have correct simplified Documentation structure", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "json",
      });

      const jsonResult = result as ContextJsonResponse;
      if (jsonResult.docs.length > 0) {
        const doc = jsonResult.docs[0];
        // Simplified Documentation type
        expect(doc).toHaveProperty("title");
        expect(doc).toHaveProperty("content");
        expect(typeof doc.title).toBe("string");
        expect(typeof doc.content).toBe("string");
      }
    });
  });

  describe("getContext - different libraries", () => {
    const client = new Context7({ apiKey });

    test("should get context for Vue", async () => {
      const result = await client.getContext("How to create components", "/vuejs/core");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("data");
      expect(result.data.length).toBeGreaterThan(0);
    });

    test("should get context for Express", async () => {
      const result = await client.getContext("How to create routes", "/expressjs/express");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("data");
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    const client = new Context7({ apiKey });

    test("should handle invalid library ID gracefully", async () => {
      await expect(
        client.getContext("test query", "/nonexistent/library")
      ).rejects.toThrow();
    });

    test("should handle invalid search query", async () => {
      await expect(client.searchLibrary("", "")).rejects.toThrow(Context7Error);
    });
  });

  describe("type inference", () => {
    const client = new Context7({ apiKey });

    test("should infer ContextTextResponse type for txt format", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react");

      expect(result).toHaveProperty("data");
      expect(typeof result.data).toBe("string");
    });

    test("should infer ContextJsonResponse for json format", async () => {
      const result = await client.getContext("How to use hooks", "/facebook/react", {
        type: "json",
      });

      expect(result).toHaveProperty("library");
      expect(result).toHaveProperty("docs");
    });
  });
});
