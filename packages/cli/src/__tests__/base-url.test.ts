import { describe, expect, test } from "vitest";
import { configuredBaseUrl } from "../utils/api.js";

describe("configuredBaseUrl", () => {
  test("prefers --base-url over CONTEXT7_BASE_URL", () => {
    expect(
      configuredBaseUrl("https://flag.example", { CONTEXT7_BASE_URL: "https://env.example" })
    ).toBe("https://flag.example");
  });

  test("falls back to CONTEXT7_BASE_URL", () => {
    expect(configuredBaseUrl(undefined, { CONTEXT7_BASE_URL: " https://env.example " })).toBe(
      "https://env.example"
    );
  });

  test("returns undefined when neither is set", () => {
    expect(configuredBaseUrl(undefined, {})).toBeUndefined();
    expect(configuredBaseUrl("  ", { CONTEXT7_BASE_URL: "" })).toBeUndefined();
  });
});
