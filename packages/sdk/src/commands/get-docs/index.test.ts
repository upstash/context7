import { describe, test, expect } from "vitest";
import { GetDocsCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";
import { CodeSnippetsResponse } from "@commands/types";

const httpClient = newHttpClient();

describe("GetDocsCommand", () => {
  test("should get library code docs as text", async () => {
    const command = new GetDocsCommand("/facebook/react", {
      docType: "code",
      format: "txt",
      limit: 10,
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("should get library info docs as text", async () => {
    const command = new GetDocsCommand("/facebook/react", {
      docType: "info",
      format: "txt",
      limit: 10,
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
  });

  test("should get library code docs as JSON", async () => {
    const command = new GetDocsCommand("/facebook/react", {
      docType: "code",
      format: "json",
      limit: 5,
    });
    const result = await command.exec(httpClient);

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("snippets");
    expect(Array.isArray((result as CodeSnippetsResponse).snippets)).toBe(true);
    expect(result).toHaveProperty("pagination");
    expect(result).toHaveProperty("metadata");
  });

  test("should get library code docs using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getDocs("/facebook/react", {
      docType: "code",
      format: "txt",
      limit: 10,
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("should get library info docs using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getDocs("/facebook/react", {
      docType: "info",
      format: "txt",
      limit: 10,
    });

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
