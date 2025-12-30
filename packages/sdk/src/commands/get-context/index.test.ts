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

  test("should get library context as JSON", async () => {
    const command = new GetContextCommand("How to use hooks", "/facebook/react", {
      type: "json",
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("selectedLibrary");
    expect(result).toHaveProperty("codeSnippets");
    expect(result).toHaveProperty("infoSnippets");
    expect(Array.isArray((result as ContextJsonResponse).codeSnippets)).toBe(true);
    expect(Array.isArray((result as ContextJsonResponse).infoSnippets)).toBe(true);
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

  test("should get library context as JSON using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getContext("How to use hooks", "/facebook/react", {
      type: "json",
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty("selectedLibrary");
    expect(result).toHaveProperty("codeSnippets");
    expect(result).toHaveProperty("infoSnippets");
    expect(Array.isArray(result.codeSnippets)).toBe(true);
    expect(Array.isArray(result.infoSnippets)).toBe(true);
  });
});
