import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkOAuthAudience,
  defaultOAuthAllowedAudiences,
  getAllowedOAuthAudiences,
  normalizeAudience,
  parseOAuthAudienceEnforcement,
} from "../src/lib/oauth-audience.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeAudience", () => {
  test("lowercases scheme and host, drops default port, fragment and trailing slashes", () => {
    expect(normalizeAudience(" HTTPS://MCP.Context7.com:443/mcp/ ")).toBe(
      "https://mcp.context7.com/mcp"
    );
    expect(normalizeAudience("https://mcp.context7.com/#frag")).toBe("https://mcp.context7.com");
    expect(normalizeAudience("https://mcp.context7.com/MCP")).toBe("https://mcp.context7.com/MCP");
    expect(normalizeAudience("http://localhost:8787/mcp?x=1")).toBe(
      "http://localhost:8787/mcp?x=1"
    );
  });

  test("only trims values that are not http(s) URLs", () => {
    expect(normalizeAudience(" client_abc ")).toBe("client_abc");
    expect(normalizeAudience("urn:example:mcp/")).toBe("urn:example:mcp");
  });
});

describe("allowed audiences", () => {
  test("defaults to the resource origin and both MCP endpoints", () => {
    expect(defaultOAuthAllowedAudiences("https://mcp.context7.com/mcp")).toEqual([
      "https://mcp.context7.com",
      "https://mcp.context7.com/mcp",
      "https://mcp.context7.com/mcp/oauth",
    ]);
    expect(getAllowedOAuthAudiences(undefined)).toEqual(new Set(defaultOAuthAllowedAudiences()));
  });

  test("reads a comma-separated override and normalizes each entry", () => {
    expect(getAllowedOAuthAudiences(" https://a.example/ , HTTP://b.example:80/mcp,, ")).toEqual(
      new Set(["https://a.example", "http://b.example/mcp"])
    );
  });
});

describe("parseOAuthAudienceEnforcement", () => {
  test("defaults to observe and accepts both modes", () => {
    expect(parseOAuthAudienceEnforcement(undefined)).toBe("observe");
    expect(parseOAuthAudienceEnforcement("")).toBe("observe");
    expect(parseOAuthAudienceEnforcement(" Observe ")).toBe("observe");
    expect(parseOAuthAudienceEnforcement("REQUIRED")).toBe("required");
  });

  test("rejects unknown values", () => {
    expect(() => parseOAuthAudienceEnforcement("require")).toThrow(/observe.*required/);
  });
});

describe("checkOAuthAudience", () => {
  test("treats a missing or non-string audience as a mismatch", () => {
    expect(checkOAuthAudience(undefined)).toEqual({
      allowed: false,
      aud: "missing",
      enforcement: "observe",
    });
    expect(checkOAuthAudience([])).toMatchObject({ allowed: false, aud: "missing" });
    expect(checkOAuthAudience(42)).toMatchObject({ allowed: false, aud: "missing" });
  });

  test("accepts a string or array containing an allowed audience", () => {
    expect(checkOAuthAudience("https://mcp.context7.com/mcp/")).toMatchObject({ allowed: true });
    expect(checkOAuthAudience(["http://localhost:8787", "https://MCP.context7.com"])).toEqual({
      allowed: true,
      aud: "http://localhost:8787,https://mcp.context7.com",
      enforcement: "observe",
    });
  });

  test("reports the enforcement mode and honours the override list", () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "required");
    vi.stubEnv("MCP_OAUTH_ALLOWED_AUDIENCES", "http://localhost:8787");

    expect(checkOAuthAudience(["http://localhost:8787/"])).toEqual({
      allowed: true,
      aud: "http://localhost:8787",
      enforcement: "required",
    });
    expect(checkOAuthAudience("https://mcp.context7.com/mcp")).toEqual({
      allowed: false,
      aud: "https://mcp.context7.com/mcp",
      enforcement: "required",
    });
  });
});
