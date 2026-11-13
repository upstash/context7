import { describe, expect, test } from "vitest";
import { Context7 } from "../client";
import { Context7JSONParseError } from "@error";
import { parseSuccessResponse, throwResponseError } from "./response";

const jsonTypes = [
  "application/json",
  "application/json; charset=utf-8",
  "Application/Json",
  "APPLICATION/JSON",
  "application/JSON; charset=UTF-8",
  "Application/JSON ; charset=utf-8",
];
const metadata = { status: 200, attempt: 0 };

describe("JSON media types", () => {
  test.each(jsonTypes)("parses JSON values for %s", async (contentType) => {
    for (const value of [null, false, true, 0, 1, "", "snowman: \u2603", "C:\\tmp\\file", [], {}]) {
      const response = new Response(JSON.stringify(value), {
        headers: { "content-type": contentType },
      });
      expect(await parseSuccessResponse(response, metadata)).toEqual({ result: value });
    }
  });

  test.each([
    undefined,
    "",
    "text/plain",
    "application/jsonp",
    "x-application/json",
    "application/json-suffix",
    "application/problem+json",
    'text/plain; profile="application/json"',
    "text/plain; application/json",
    "Application/Json\u00a0",
    "Application/Json\u00a0; charset=utf-8",
    "\u00a0Application/Json",
    "application/json, text/plain",
    '"application/json"',
  ])("preserves text for %s", async (contentType) => {
    const response = new Response("plain text", {
      headers: contentType === undefined ? undefined : { "content-type": contentType },
    });
    expect(await parseSuccessResponse(response, metadata)).toEqual({
      result: "plain text",
      headers: undefined,
    });
  });

  test.each(jsonTypes)("classifies malformed JSON errors for %s", async (contentType) => {
    const response = new Response("<invalid>", {
      status: 400,
      headers: { "content-type": contentType },
    });
    await expect(
      throwResponseError(response, { status: 400, attempt: 0 }, false)
    ).rejects.toBeInstanceOf(Context7JSONParseError);
  });

  test.each([
    'text/plain; profile="application/json"',
    "application/jsonp",
    "Application/Json\u00a0; charset=utf-8",
  ])("keeps non-JSON errors generic for %s", async (contentType) => {
    const response = new Response("<invalid>", {
      status: 400,
      headers: { "content-type": contentType },
    });
    await expect(
      throwResponseError(response, { status: 400, attempt: 0 }, false)
    ).rejects.toMatchObject({ name: "Context7Error", code: "http_error" });
  });

  test("parses generated type casing and parameter variants", async () => {
    let seed = 590;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed;
    };
    for (let index = 0; index < 256; index++) {
      const mediaType = [..."application/json"]
        .map((character) => (random() & 0x100 ? character.toUpperCase() : character))
        .join("");
      const contentType = mediaType + (index % 2 ? '; profile="semi; comma, hash# question?"' : "");
      const value = { index, text: "C:\\tmp\\file; unicode: \u2603", empty: "", pair: [0, 1] };
      const response = new Response(JSON.stringify(value), {
        headers: { "content-type": contentType },
      });
      expect(await parseSuccessResponse(response, metadata)).toEqual({ result: value });
    }
  });

  test("returns public search results for mixed-case JSON", async () => {
    const client = new Context7({
      apiKey: "ctx7sk-local-fixture",
      retry: false,
      fetch: async () =>
        new Response(JSON.stringify({ results: [] }), {
          headers: { "content-type": "Application/Json" },
        }),
    });
    await expect(client.searchLibrary("hooks", "react")).resolves.toEqual([]);
  });
});
