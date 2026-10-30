import { describe, expect, test } from "vitest";
import { resolveStdioApiKey } from "../src/lib/utils.js";

describe("resolveStdioApiKey", () => {
  test("uses the --api-key value", () => {
    expect(resolveStdioApiKey("ctx7sk-abc", "ctx7sk-env")).toEqual({
      apiKey: "ctx7sk-abc",
      ignoredPlaceholders: [],
    });
  });

  test("falls back to CONTEXT7_API_KEY when the flag is missing or empty", () => {
    expect(resolveStdioApiKey(undefined, "ctx7sk-env").apiKey).toBe("ctx7sk-env");
    expect(resolveStdioApiKey("  ", "ctx7sk-env").apiKey).toBe("ctx7sk-env");
  });

  // Gemini CLI starts the extension with the literal "${CONTEXT7_API_KEY}"
  // when the user skips its API key prompt.
  test("ignores an unresolved ${VAR} placeholder and runs without a key", () => {
    expect(resolveStdioApiKey("${CONTEXT7_API_KEY}", undefined)).toEqual({
      ignoredPlaceholders: ["${CONTEXT7_API_KEY}"],
    });
  });

  test("ignores a $VAR placeholder and falls back to the env key", () => {
    expect(resolveStdioApiKey("$CONTEXT7_API_KEY", "ctx7sk-env")).toEqual({
      apiKey: "ctx7sk-env",
      ignoredPlaceholders: ["$CONTEXT7_API_KEY"],
    });
  });

  test("returns no key when both sources are empty or placeholders", () => {
    expect(resolveStdioApiKey(undefined, undefined)).toEqual({ ignoredPlaceholders: [] });
    expect(resolveStdioApiKey("${env:CONTEXT7_API_KEY}", "")).toEqual({
      ignoredPlaceholders: ["${env:CONTEXT7_API_KEY}"],
    });
  });

  test("keeps a real key that merely contains a dollar sign", () => {
    expect(resolveStdioApiKey("ctx7sk-a$b", undefined).apiKey).toBe("ctx7sk-a$b");
  });
});
