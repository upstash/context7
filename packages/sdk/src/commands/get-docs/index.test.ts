import { describe, test } from "node:test";
import assert from "node:assert";
import { GetDocsCommand } from "./index";
import { newHttpClient } from "../../utils/test-utils";
import { Context7 } from "../../client";

const httpClient = newHttpClient();

describe("GetDocsCommand", () => {
  test("should get library code docs", async () => {
    const command = new GetDocsCommand("/facebook/react", {
      type: "code",
      limit: 10,
    });
    const result = await command.exec(httpClient);

    assert(result !== undefined);
    assert(typeof result === "string");
    assert(result.length > 0);
  });

  test("should get library info docs", async () => {
    const command = new GetDocsCommand("/facebook/react", {
      type: "info",
      limit: 10,
    });
    const result = await command.exec(httpClient);

    assert(result !== undefined);
    assert(typeof result === "string");
    assert(result.length > 0);
  });

  test("should get library code docs using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getDocs("/facebook/react", {
      type: "code",
      limit: 10,
    });

    assert(result !== undefined);
    assert(typeof result === "string");
    assert(result.length > 0);
  });

  test("should get library info docs using client", async () => {
    const client = new Context7({
      apiKey: process.env.CONTEXT7_API_KEY || process.env.API_KEY!,
    });

    const result = await client.getDocs("/facebook/react", {
      type: "info",
      limit: 10,
    });

    assert(result !== undefined);
    assert(typeof result === "string");
    assert(result.length > 0);
  });
});
