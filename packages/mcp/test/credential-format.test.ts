import { describe, it, expect } from "vitest";
import { isApiKeyFormat, isJWT } from "../src/lib/jwt.js";

describe("isJWT", () => {
  it("accepts a three-segment token", () => {
    expect(isJWT("aaa.bbb.ccc")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isJWT("ctx7sk-1234")).toBe(false);
    expect(isJWT("aaa.bbb")).toBe(false);
    expect(isJWT("")).toBe(false);
  });
});

describe("isApiKeyFormat", () => {
  it("accepts member and enterprise key prefixes", () => {
    expect(isApiKeyFormat("ctx7sk-7504e73e-dfcf-449f-b19f-f6f8285c4b3c")).toBe(true);
    expect(isApiKeyFormat("ctx7op-abcdef_0123456789")).toBe(true);
  });

  // The endpoint that advertises authentication used to let any bearer string
  // through and open a session; these are the strings that must not qualify.
  it.each(["totally-not-a-real-token", "Bearer", "", "ctx7sk", "ctx7-1234", "sk-live-abc"])(
    "rejects %s",
    (token) => {
      expect(isApiKeyFormat(token)).toBe(false);
    }
  );
});
