import { afterEach, describe, expect, test } from "vitest";
import {
  configuredBaseUrl,
  DEFAULT_CONTEXT7_BASE_URL,
  getBaseUrl,
  isHostedDeployment,
  setBaseUrl,
} from "../utils/api.js";

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

describe("setBaseUrl", () => {
  afterEach(() => setBaseUrl(DEFAULT_CONTEXT7_BASE_URL));

  test("drops trailing slashes, so request paths do not start with //", () => {
    setBaseUrl("https://ctx7.example.com/");
    expect(getBaseUrl()).toBe("https://ctx7.example.com");
    setBaseUrl("https://ctx7.example.com/context7//");
    expect(getBaseUrl()).toBe("https://ctx7.example.com/context7");
  });

  test("still treats the hosted URL with a trailing slash as hosted", () => {
    setBaseUrl("https://context7.com/");
    expect(isHostedDeployment()).toBe(true);
  });
});
