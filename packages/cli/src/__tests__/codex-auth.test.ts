import { describe, test, expect } from "vitest";
import {
  parseCodexAuthStatus,
  hasStaleOAuthCredential,
  staleOAuthCredentialHint,
} from "../setup/codex-auth.js";

describe("parseCodexAuthStatus", () => {
  test("reads auth_status from `codex mcp get --json` output", () => {
    const stdout = JSON.stringify({
      name: "context7",
      enabled: true,
      auth_status: "oauth",
      transport: { type: "streamable_http", url: "https://mcp.context7.com/mcp" },
    });
    expect(parseCodexAuthStatus(stdout)).toBe("oauth");
  });

  test.each(["unsupported", "not_logged_in", "bearer_token", "oauth"])(
    "accepts the %s status",
    (status) => {
      expect(parseCodexAuthStatus(JSON.stringify({ auth_status: status }))).toBe(status);
    }
  );

  test("returns undefined for an unknown status", () => {
    expect(parseCodexAuthStatus(JSON.stringify({ auth_status: "something_new" }))).toBeUndefined();
  });

  test("returns undefined when auth_status is absent", () => {
    expect(parseCodexAuthStatus(JSON.stringify({ name: "context7" }))).toBeUndefined();
  });

  test("returns undefined for non-JSON output", () => {
    expect(parseCodexAuthStatus("error: no such server")).toBeUndefined();
    expect(parseCodexAuthStatus("")).toBeUndefined();
  });

  test("returns undefined for JSON that is not an object", () => {
    expect(parseCodexAuthStatus("null")).toBeUndefined();
    expect(parseCodexAuthStatus("[1,2,3]")).toBeUndefined();
  });
});

describe("hasStaleOAuthCredential", () => {
  test("flags a stored OAuth credential", () => {
    expect(hasStaleOAuthCredential("oauth")).toBe(true);
  });

  // Codex reports not_logged_in when a stored credential exists but its refresh
  // token was already rejected, which is the exact state that breaks startup.
  test("flags a credential that needs reauthorization", () => {
    expect(hasStaleOAuthCredential("not_logged_in")).toBe(true);
  });

  test("ignores servers with no OAuth credential", () => {
    expect(hasStaleOAuthCredential("bearer_token")).toBe(false);
    expect(hasStaleOAuthCredential("unsupported")).toBe(false);
  });

  test("ignores an unavailable probe", () => {
    expect(hasStaleOAuthCredential(undefined)).toBe(false);
  });
});

describe("staleOAuthCredentialHint", () => {
  test("names the server and the command that clears it", () => {
    const hint = staleOAuthCredentialHint("context7");
    expect(hint).toContain("context7");
    expect(hint).toContain("codex mcp logout context7");
  });
});
