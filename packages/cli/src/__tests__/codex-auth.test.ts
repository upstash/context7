import { describe, test, expect } from "vitest";
import { reportsStoredOAuthCredential } from "../setup/codex-auth.js";

describe("reportsStoredOAuthCredential", () => {
  test("flags a stored credential", () => {
    const stdout = JSON.stringify({
      name: "context7",
      enabled: true,
      auth_status: "oauth",
      transport: { type: "streamable_http", url: "https://mcp.context7.com/mcp" },
    });
    expect(reportsStoredOAuthCredential(stdout)).toBe(true);
  });

  // not_logged_in also covers "no credential, server merely advertises OAuth",
  // which is every user who never logged in. Claiming a stale credential there
  // would be wrong for the common case.
  test.each(["not_logged_in", "bearer_token", "unsupported", "something_new"])(
    "does not flag the %s status",
    (status) => {
      expect(reportsStoredOAuthCredential(JSON.stringify({ auth_status: status }))).toBe(false);
    }
  );

  test("does not flag output without a status", () => {
    expect(reportsStoredOAuthCredential(JSON.stringify({ name: "context7" }))).toBe(false);
  });

  test("does not flag unparseable output", () => {
    expect(reportsStoredOAuthCredential("error: no such server")).toBe(false);
    expect(reportsStoredOAuthCredential("")).toBe(false);
    expect(reportsStoredOAuthCredential("null")).toBe(false);
    expect(reportsStoredOAuthCredential("[1,2,3]")).toBe(false);
  });
});
