import { describe, test, expect } from "vitest";
import { GetContextCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";
import { ContextJsonResponse, ContextTextResponse } from "@commands/types";

const httpClient = newHttpClient();

describe("GetContextCommand", () => {
  test("should get library context as text (default)", async () => {
    const command = new GetContextCommand("How to use hooks", "/facebook/react");
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("data");
    expect(typeof (result as ContextTextResponse).data).toBe("string");
    expect((result as ContextTextResponse).data.length).toBeGreaterThan(0);
  });

  test("should get library context as JSON with simplified Documentation type", async () => {
    const command = new GetContextCommand("How to use hooks", "/facebook/react", {
      type: "json",
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");

    const jsonResult = result as ContextJsonResponse;
    expect(jsonResult).toHaveProperty("library");
    expect(jsonResult).toHaveProperty("docs");
    expect(Array.isArray(jsonResult.docs)).toBe(true);

    // Verify simplified Documentation structure
    if (jsonResult.docs.length > 0) {
      const doc = jsonResult.docs[0];
      expect(doc).toHaveProperty("title");
      expect(doc).toHaveProperty("content");
    }
  });

  test("should get library context as text using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getContext("How to use hooks", "/facebook/react");

    expect(result).toBeDefined();
    expect(result).toHaveProperty("data");
    expect(result.data.length).toBeGreaterThan(0);
  });

  test("should get library context as JSON using client with simplified types", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getContext("How to use hooks", "/facebook/react", {
      type: "json",
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("library");
    expect(result).toHaveProperty("docs");
    expect(Array.isArray(result.docs)).toBe(true);

    // Verify simplified Documentation structure
    if (result.docs.length > 0) {
      const doc = result.docs[0];
      expect(doc).toHaveProperty("title");
      expect(doc).toHaveProperty("content");
    }
  });
});
