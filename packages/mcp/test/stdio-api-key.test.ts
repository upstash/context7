import { describe, expect, test } from "vitest";
import { usableApiKey } from "../src/lib/mcp-http-auth.js";

describe("usableApiKey", () => {
  test.each([
    ["ctx7sk-abc", "ctx7sk-abc"],
    ["  ctx7sk-abc  ", "ctx7sk-abc"],
    ["ctx7sk-a$b", "ctx7sk-a$b"],
    [undefined, undefined],
    ["", undefined],
    ["   ", undefined],
    // Gemini CLI starts the extension with the literal "${CONTEXT7_API_KEY}"
    // when the user skips its API key prompt.
    ["${CONTEXT7_API_KEY}", undefined],
    ["${env:CONTEXT7_API_KEY}", undefined],
    ["$CONTEXT7_API_KEY", undefined],
  ])("%j -> %j", (input, expected) => {
    expect(usableApiKey(input)).toBe(expected);
  });
});
