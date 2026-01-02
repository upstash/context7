import { describe, test, expect } from "vitest";
import { GetContextCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";
import type { Documentation } from "@commands/types";

const httpClient = newHttpClient();

describe("GetContextCommand", () => {
  test("should get library context as text (default)", async () => {
    const command = new GetContextCommand("How to use hooks", "/facebook/react");
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("should get library context as JSON array of Documentation", async () => {
    const command = new GetContextCommand("How to use hooks", "/facebook/react", {
      type: "json",
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);

    const docs = result as Documentation[];
    expect(docs.length).toBeGreaterThan(0);

    const doc = docs[0];
    expect(doc).toHaveProperty("title");
    expect(doc).toHaveProperty("content");
    expect(doc).toHaveProperty("source");
  });

  test("should get library context as text using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getContext("How to use hooks", "/facebook/react");

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("should get library context as JSON using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getContext("How to use hooks", "/facebook/react", {
      type: "json",
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const doc = result[0];
    expect(doc).toHaveProperty("title");
    expect(doc).toHaveProperty("content");
    expect(doc).toHaveProperty("source");
  });
});
