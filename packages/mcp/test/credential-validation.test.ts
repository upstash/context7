import { describe, expect, test } from "vitest";
import { isSupportedOpaqueCredential } from "../src/lib/auth/credential-validation.js";

describe("isSupportedOpaqueCredential", () => {
  test.each([
    "ctx7sk-7504e73e-dfcf-449f-b19f-f6f8285c4b3c",
    "ctx7op-abcdef_0123456789",
    "oat_abcdefghijklmnopqrstuvwxyz0123456789",
  ])("accepts a supported credential format: %s", (token) => {
    expect(isSupportedOpaqueCredential(token)).toBe(true);
  });

  test.each([
    "",
    "not-a-jwt",
    "ctx7sk-",
    "oat_",
    "sk-live-abc",
    "Bearer ctx7sk-valid",
    "ctx7sk-invalid value",
  ])("rejects an unsupported credential format: %s", (token) => {
    expect(isSupportedOpaqueCredential(token)).toBe(false);
  });
});
