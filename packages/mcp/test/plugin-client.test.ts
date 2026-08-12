import { describe, expect, test } from "vitest";
import { isPluginClientQuery } from "../src/lib/auth/plugin-client.js";

describe("isPluginClientQuery", () => {
  test("matches claude-code-plugin and other plugin client ids", () => {
    expect(isPluginClientQuery("claude-code-plugin")).toBe(true);
    expect(isPluginClientQuery("cursor-plugin")).toBe(true);
    expect(isPluginClientQuery("plugin")).toBe(true);
  });

  test("ignores non-plugin client ids and missing values", () => {
    expect(isPluginClientQuery("claude-code")).toBe(false);
    expect(isPluginClientQuery("claude-desktop")).toBe(false);
    expect(isPluginClientQuery("")).toBe(false);
    expect(isPluginClientQuery(undefined)).toBe(false);
    expect(isPluginClientQuery(null)).toBe(false);
    expect(isPluginClientQuery(1)).toBe(false);
  });

  test("uses the first value when the query param is repeated", () => {
    expect(isPluginClientQuery(["claude-code-plugin", "other"])).toBe(true);
    expect(isPluginClientQuery(["claude-code", "plugin"])).toBe(false);
  });
});
