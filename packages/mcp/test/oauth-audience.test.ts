import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkOAuthAudience,
  defaultOAuthAllowedAudiences,
  FOREIGN_OAUTH_AUDIENCE_MESSAGE,
  getAllowedOAuthAudienceHosts,
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

  test("drops the query string only on the hosts it is told to", () => {
    const queryIgnoredHosts = new Set(["mcp.context7.com"]);
    expect(
      normalizeAudience("https://mcp.context7.com/mcp?client=claude-code-plugin", {
        queryIgnoredHosts,
      })
    ).toBe("https://mcp.context7.com/mcp");
    expect(
      normalizeAudience("https://mcp.context7.com/mcp/?client=codex", { queryIgnoredHosts })
    ).toBe("https://mcp.context7.com/mcp");
    expect(
      normalizeAudience("https://mcp.joom.it/context7?client=codex", { queryIgnoredHosts })
    ).toBe("https://mcp.joom.it/context7?client=codex");
    expect(normalizeAudience("https://mcp.context7.com/mcp?client=codex")).toBe(
      "https://mcp.context7.com/mcp?client=codex"
    );
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

  test("drops the query string of a configured entry, so it can still match a token", () => {
    expect(getAllowedOAuthAudiences("https://a.example/mcp?a=1, urn:example:mcp?x")).toEqual(
      new Set(["https://a.example/mcp", "urn:example:mcp?x"])
    );
  });

  test("lists the hosts of the allowed http(s) audiences", () => {
    expect(getAllowedOAuthAudienceHosts()).toEqual(new Set(["mcp.context7.com"]));
    expect(
      getAllowedOAuthAudienceHosts(
        new Set(["http://localhost:8787/mcp", "https://a.example", "urn:example:mcp"])
      )
    ).toEqual(new Set(["localhost:8787", "a.example"]));
  });
});

describe("parseOAuthAudienceEnforcement", () => {
  test("defaults to observe and accepts the three modes", () => {
    expect(parseOAuthAudienceEnforcement(undefined)).toBe("observe");
    expect(parseOAuthAudienceEnforcement("")).toBe("observe");
    expect(parseOAuthAudienceEnforcement(" Observe ")).toBe("observe");
    expect(parseOAuthAudienceEnforcement("Foreign")).toBe("foreign");
    expect(parseOAuthAudienceEnforcement("REQUIRED")).toBe("required");
  });

  test("rejects unknown values", () => {
    expect(() => parseOAuthAudienceEnforcement("require")).toThrow(
      /"observe", "foreign" or "required"/
    );
    expect(() => parseOAuthAudienceEnforcement("foreign-only")).toThrow(/received "foreign-only"/);
  });
});

describe("FOREIGN_OAUTH_AUDIENCE_MESSAGE", () => {
  test("is the agreed wording and safe inside a quoted WWW-Authenticate parameter", () => {
    expect(FOREIGN_OAUTH_AUDIENCE_MESSAGE).toBe(
      "This token was issued for another server. If you connect through a gateway or proxy, use a Context7 API key instead."
    );
    expect(FOREIGN_OAUTH_AUDIENCE_MESSAGE).not.toMatch(/["\\]/);
  });
});

describe("checkOAuthAudience", () => {
  const ALLOWED = "https://mcp.context7.com/mcp";
  const FOREIGN = "https://mcp.joom.it/context7";

  test("treats a missing or non-string audience as a mismatch", () => {
    expect(checkOAuthAudience(undefined)).toEqual({
      allowed: false,
      aud: "missing",
      enforcement: "observe",
      outcome: "accepted",
    });
    expect(checkOAuthAudience([])).toMatchObject({ allowed: false, aud: "missing" });
    expect(checkOAuthAudience(42)).toMatchObject({ allowed: false, aud: "missing" });
    expect(checkOAuthAudience([42, null])).toMatchObject({ allowed: false, aud: "missing" });
  });

  test("accepts a string or array containing an allowed audience", () => {
    expect(checkOAuthAudience("https://mcp.context7.com/mcp/")).toMatchObject({ allowed: true });
    expect(checkOAuthAudience(["http://localhost:8787", "https://MCP.context7.com"])).toEqual({
      allowed: true,
      aud: "http://localhost:8787,https://mcp.context7.com",
      enforcement: "observe",
      outcome: "accepted",
    });
  });

  test.each([
    ["observe", "accepted", "accepted", "accepted"],
    ["foreign", "accepted", "accepted", "rejected"],
    ["required", "accepted", "rejected", "rejected"],
  ] as const)(
    "%s: allowed → %s, missing → %s, foreign → %s",
    (enforcement, onAllowed, onMissing, onForeign) => {
      vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", enforcement);

      expect(checkOAuthAudience(ALLOWED)).toEqual({
        allowed: true,
        aud: ALLOWED,
        enforcement,
        outcome: onAllowed,
      });
      expect(checkOAuthAudience(undefined)).toEqual({
        allowed: false,
        aud: "missing",
        enforcement,
        outcome: onMissing,
      });
      expect(checkOAuthAudience(FOREIGN)).toEqual({
        allowed: false,
        aud: FOREIGN,
        enforcement,
        outcome: onForeign,
      });
    }
  );

  test("ignores the query string on an allowed host, as Cursor writes it", () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "foreign");

    for (const aud of [
      "https://mcp.context7.com/mcp?client=claude-code-plugin",
      "https://mcp.context7.com/mcp?client=codex",
      "https://mcp.context7.com/mcp/oauth?client=codex",
    ]) {
      expect(checkOAuthAudience(aud)).toMatchObject({
        allowed: true,
        aud: aud.replace(/\?.*$/, ""),
        outcome: "accepted",
      });
    }
  });

  test("keeps the query string of a foreign host, so it stays foreign and is logged as sent", () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "foreign");

    expect(checkOAuthAudience("https://mcp.joom.it/context7?client=codex")).toEqual({
      allowed: false,
      aud: "https://mcp.joom.it/context7?client=codex",
      enforcement: "foreign",
      outcome: "rejected",
    });
    // Same host, another path: the query string is dropped but the path still
    // has to match.
    expect(checkOAuthAudience("https://mcp.context7.com/other?client=codex")).toEqual({
      allowed: false,
      aud: "https://mcp.context7.com/other",
      enforcement: "foreign",
      outcome: "rejected",
    });
  });

  test("reports the enforcement mode and honours the override list", () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "required");
    vi.stubEnv("MCP_OAUTH_ALLOWED_AUDIENCES", "http://localhost:8787");

    expect(checkOAuthAudience(["http://localhost:8787/"])).toEqual({
      allowed: true,
      aud: "http://localhost:8787",
      enforcement: "required",
      outcome: "accepted",
    });
    expect(checkOAuthAudience("https://mcp.context7.com/mcp")).toEqual({
      allowed: false,
      aud: "https://mcp.context7.com/mcp",
      enforcement: "required",
      outcome: "rejected",
    });
  });

  test("the override list also decides which hosts drop their query string", () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE_ENFORCEMENT", "foreign");
    vi.stubEnv("MCP_OAUTH_ALLOWED_AUDIENCES", "http://localhost:8787/mcp?a=1");

    expect(checkOAuthAudience("http://localhost:8787/mcp")).toMatchObject({
      allowed: true,
      aud: "http://localhost:8787/mcp",
      outcome: "accepted",
    });

    expect(checkOAuthAudience("http://localhost:8787/mcp?client=codex")).toMatchObject({
      allowed: true,
      aud: "http://localhost:8787/mcp",
      outcome: "accepted",
    });
    expect(checkOAuthAudience("https://mcp.context7.com/mcp?client=codex")).toMatchObject({
      allowed: false,
      aud: "https://mcp.context7.com/mcp?client=codex",
      outcome: "rejected",
    });
  });
});
