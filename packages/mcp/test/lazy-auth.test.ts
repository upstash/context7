import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// These env vars change module-level constants, so each case re-imports the
// module. `delete` rather than assignment: `process.env.X = undefined` stores
// the string "undefined", which would leave a bogus entry in PROTECTED_TOOLS.
const ENV_KEYS = ["CONTEXT7_PROTECTED_TOOLS", "CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS"] as const;

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function loadLazyAuth(env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  vi.resetModules();
  clearEnv();
  Object.assign(process.env, env);
  const quota = await import("../src/lib/auth/quota-state.js");
  quota.resetQuotaState();
  return { ...(await import("../src/lib/auth/lazy-auth.js")), quota };
}

beforeEach(clearEnv);
afterEach(clearEnv);

function toolCall(name: string, id: unknown = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } };
}

const anonymous = async () => ({ authenticated: false });
const signedIn = async () => ({ authenticated: true });

/** A response shaped like context7app's, which attaches these on every /api/v2 reply. */
function backendResponse(headers: Record<string, string>, status = 200) {
  return { status, headers: { get: (name: string) => headers[name] ?? null } };
}

const ANON_SPENT = { "Context7-Quota-Tier": "anonymous", "RateLimit-Remaining": "0" };
const ANON_LEFT = { "Context7-Quota-Tier": "anonymous", "RateLimit-Remaining": "37" };

describe("toolCallsIn", () => {
  test("extracts tool names from a single message and a batch", async () => {
    const { toolCallsIn } = await loadLazyAuth();
    expect(toolCallsIn(toolCall("query-docs"))).toEqual(["query-docs"]);
    expect(toolCallsIn([toolCall("a"), { method: "tools/list" }, toolCall("b")])).toEqual([
      "a",
      "b",
    ]);
  });

  test("ignores methods that are not tools/call", async () => {
    const { toolCallsIn } = await loadLazyAuth();
    expect(toolCallsIn({ method: "initialize" })).toEqual([]);
    expect(toolCallsIn({ method: "tools/list" })).toEqual([]);
    expect(toolCallsIn(undefined)).toEqual([]);
  });
});

describe("evaluateLazyAuth — pass-through", () => {
  test("initialize and tools/list are never gated", async () => {
    const { evaluateLazyAuth } = await loadLazyAuth();
    for (const method of ["initialize", "tools/list", "notifications/initialized"]) {
      const challenge = await evaluateLazyAuth({
        body: { method },
        resolveAuth: anonymous,
        clientIp: "1.1.1.1",
      });
      expect(challenge, method).toBeUndefined();
    }
  });

  test("a public tool passes while the backend still reports requests left", async () => {
    const { evaluateLazyAuth, quota } = await loadLazyAuth();
    quota.recordQuotaSignal("1.1.1.1", quota.readQuotaSignal(backendResponse(ANON_LEFT)));
    expect(
      await evaluateLazyAuth({
        body: toolCall("query-docs"),
        resolveAuth: anonymous,
        clientIp: "1.1.1.1",
      })
    ).toBeUndefined();
  });

  test("credentials are not verified for requests that cannot be gated", async () => {
    const { evaluateLazyAuth } = await loadLazyAuth();
    const resolveAuth = vi.fn(anonymous);
    await evaluateLazyAuth({ body: { method: "tools/list" }, resolveAuth, clientIp: "1.1.1.1" });
    await evaluateLazyAuth({
      body: toolCall("query-docs"),
      resolveAuth,
      clientIp: "1.1.1.1",
    });
    // Neither request is gateable, so neither should cost a JWT verification.
    expect(resolveAuth).not.toHaveBeenCalled();
  });
});

describe("evaluateLazyAuth — protected tools", () => {
  test("an anonymous call to a protected tool is challenged", async () => {
    const { evaluateLazyAuth } = await loadLazyAuth({
      CONTEXT7_PROTECTED_TOOLS: "secret-tool",
    });
    const challenge = await evaluateLazyAuth({
      body: toolCall("secret-tool", 42),
      resolveAuth: anonymous,
      clientIp: "1.1.1.1",
    });
    expect(challenge).toMatchObject({ error: "invalid_token", id: 42 });
    expect(challenge?.message).toContain("requires authentication");
  });

  test("a signed-in caller reaches a protected tool", async () => {
    const { evaluateLazyAuth } = await loadLazyAuth({
      CONTEXT7_PROTECTED_TOOLS: "secret-tool",
    });
    expect(
      await evaluateLazyAuth({
        body: toolCall("secret-tool"),
        resolveAuth: signedIn,
        clientIp: "1.1.1.1",
      })
    ).toBeUndefined();
  });

  test("no tool is protected unless configured", async () => {
    const { PROTECTED_TOOLS, evaluateLazyAuth } = await loadLazyAuth();
    expect(PROTECTED_TOOLS.size).toBe(0);
    expect(
      await evaluateLazyAuth({
        body: toolCall("query-docs"),
        resolveAuth: anonymous,
        clientIp: "1.1.1.1",
      })
    ).toBeUndefined();
  });
});

describe("evaluateLazyAuth — backend monthly quota", () => {
  test("challenges once the backend reports the free requests spent", async () => {
    const { evaluateLazyAuth, quota } = await loadLazyAuth();
    quota.recordQuotaSignal("8.8.8.8", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    const challenge = await evaluateLazyAuth({
      body: toolCall("query-docs", 7),
      resolveAuth: anonymous,
      clientIp: "8.8.8.8",
    });
    expect(challenge).toMatchObject({ error: "invalid_token", id: 7 });
    expect(challenge?.message).toContain("free monthly Context7 requests");
  });

  test("a signed-in caller is never gated on quota", async () => {
    const { evaluateLazyAuth, quota } = await loadLazyAuth();
    quota.recordQuotaSignal("8.8.8.8", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    expect(
      await evaluateLazyAuth({
        body: toolCall("query-docs"),
        resolveAuth: signedIn,
        clientIp: "8.8.8.8",
      })
    ).toBeUndefined();
  });

  test("the verdict is per client", async () => {
    const { evaluateLazyAuth, quota } = await loadLazyAuth();
    quota.recordQuotaSignal("8.8.8.8", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    expect(
      await evaluateLazyAuth({
        body: toolCall("query-docs"),
        resolveAuth: anonymous,
        clientIp: "8.8.8.8",
      })
    ).toBeDefined();
    expect(
      await evaluateLazyAuth({
        body: toolCall("query-docs"),
        resolveAuth: anonymous,
        clientIp: "1.2.3.4",
      })
    ).toBeUndefined();
  });

  test("the challenge echoes the tools/call id, not the first id in a batch", async () => {
    const { evaluateLazyAuth, quota } = await loadLazyAuth();
    quota.recordQuotaSignal("8.8.8.8", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    const challenge = await evaluateLazyAuth({
      body: [{ jsonrpc: "2.0", id: "list", method: "tools/list" }, toolCall("query-docs", "call")],
      resolveAuth: anonymous,
      clientIp: "8.8.8.8",
    });
    expect(challenge?.id).toBe("call");
  });
});

describe("quota-state — mirroring the backend verdict", () => {
  test("a 429 arms the challenge even without the tier header", async () => {
    const { quota } = await loadLazyAuth();
    // Edge rate limiters refuse before the backend attaches quota headers.
    quota.recordQuotaSignal("9.9.9.9", quota.readQuotaSignal(backendResponse({}, 429)));
    expect(quota.isQuotaExhausted("9.9.9.9")).toBe(true);
  });

  test("an authenticated tier clears a verdict recorded while anonymous", async () => {
    const { quota } = await loadLazyAuth();
    quota.recordQuotaSignal("9.9.9.9", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    expect(quota.isQuotaExhausted("9.9.9.9")).toBe(true);
    quota.recordQuotaSignal(
      "9.9.9.9",
      quota.readQuotaSignal(
        backendResponse({ "Context7-Quota-Tier": "free", "RateLimit-Remaining": "900" })
      )
    );
    expect(quota.isQuotaExhausted("9.9.9.9")).toBe(false);
  });

  test("a response with no tier header never clears an existing verdict", async () => {
    const { quota } = await loadLazyAuth();
    quota.recordQuotaSignal("9.9.9.9", quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    // A 500 from a proxy says nothing about who the caller is; the verdict stands.
    quota.recordQuotaSignal("9.9.9.9", quota.readQuotaSignal(backendResponse({}, 500)));
    expect(quota.isQuotaExhausted("9.9.9.9")).toBe(true);
  });

  test("an unlimited tier is never exhausted", async () => {
    const { quota } = await loadLazyAuth();
    expect(
      quota.signalsExhaustion(
        quota.readQuotaSignal(
          backendResponse({
            "Context7-Quota-Tier": "anonymous",
            "RateLimit-Remaining": "unlimited",
          })
        )
      )
    ).toBe(false);
  });

  test("the verdict expires when the backend says the quota resets", async () => {
    vi.useFakeTimers();
    try {
      const { quota } = await loadLazyAuth();
      const inTwoHours = Math.floor(Date.now() / 1000) + 7200;
      quota.recordQuotaSignal(
        "9.9.9.9",
        quota.readQuotaSignal(
          backendResponse({ ...ANON_SPENT, "RateLimit-Reset": String(inTwoHours) })
        )
      );
      expect(quota.isQuotaExhausted("9.9.9.9")).toBe(true);
      vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);
      expect(quota.isQuotaExhausted("9.9.9.9")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a reset already in the past falls back to a bounded window", async () => {
    vi.useFakeTimers();
    try {
      const { quota } = await loadLazyAuth();
      quota.recordQuotaSignal(
        "9.9.9.9",
        quota.readQuotaSignal(backendResponse({ ...ANON_SPENT, "RateLimit-Reset": "1" }))
      );
      expect(quota.isQuotaExhausted("9.9.9.9")).toBe(true);
      vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
      expect(quota.isQuotaExhausted("9.9.9.9")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no fingerprint is a no-op rather than a shared bucket", async () => {
    const { quota } = await loadLazyAuth();
    quota.recordQuotaSignal(undefined, quota.readQuotaSignal(backendResponse(ANON_SPENT)));
    expect(quota.isQuotaExhausted(undefined)).toBe(false);
  });
});

describe("challengeTransportFor", () => {
  test("defaults to the spec-compliant 401 for unknown and missing clients", async () => {
    const { challengeTransportFor } = await loadLazyAuth();
    for (const ua of [
      undefined,
      "claude-code/2.1.0",
      "Visual Studio Code/1.108.0",
      "Cursor/1.9.2",
      "node",
      "codex_cli_rs/0.104.0", // Codex CLI needs `codex mcp login`, not the _meta form
    ]) {
      expect(challengeTransportFor(ua), String(ua)).toBe("http-401");
    }
  });

  test("selects the tool-result form for ChatGPT, case-insensitively", async () => {
    const { challengeTransportFor } = await loadLazyAuth();
    expect(challengeTransportFor("openai-mcp/1.0")).toBe("tool-result");
    expect(challengeTransportFor("ChatGPT/1.2025.0")).toBe("tool-result");
  });

  test("matches the product token, not a mention inside a comment", async () => {
    const { challengeTransportFor } = await loadLazyAuth();
    expect(challengeTransportFor("Cursor/1.9.2 (chatgpt-extension)")).toBe("http-401");
  });

  test("the client list is overridable", async () => {
    const { challengeTransportFor } = await loadLazyAuth({
      CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS: "some-new-client",
    });
    expect(challengeTransportFor("some-new-client/1.0")).toBe("tool-result");
    expect(challengeTransportFor("chatgpt/1.0")).toBe("http-401");
  });
});

describe("challenge payloads", () => {
  const base = "https://mcp.context7.com";
  const challenge = {
    error: "invalid_token" as const,
    message: "Sign in to continue.",
    id: 7,
  };

  test("the WWW-Authenticate header carries discovery, scope and a description", async () => {
    const { buildWwwAuthenticate } = await loadLazyAuth();
    expect(buildWwwAuthenticate(base)).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
    expect(buildWwwAuthenticate(base, "invalid_token", "Sign in")).toBe(
      `Bearer error="invalid_token", error_description="Sign in", ` +
        `resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
  });

  test("quotes and newlines cannot break header parsing", async () => {
    const { buildWwwAuthenticate } = await loadLazyAuth();
    expect(buildWwwAuthenticate(base, "invalid_token", 'say "hi"\nthen  bye')).toContain(
      'error_description="say hi then bye"'
    );
  });

  test("the http form is a JSON-RPC error echoing the request id", async () => {
    const { buildHttpChallenge } = await loadLazyAuth();
    expect(buildHttpChallenge(challenge)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Sign in to continue." },
      id: 7,
    });
  });

  test("the tool-result form carries the challenge in _meta", async () => {
    const { buildToolResultChallenge } = await loadLazyAuth();
    const body = buildToolResultChallenge(challenge, base);
    expect(body.result.isError).toBe(true);
    expect(body.result.content).toEqual([{ type: "text", text: challenge.message }]);
    const header = body.result._meta["mcp/www_authenticate"][0];
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(`error_description="${challenge.message}"`);
    expect(header).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  });
});

describe("securitySchemesFor", () => {
  test("public tools advertise mixed auth so clients can call them anonymously", async () => {
    const { securitySchemesFor, toolAuthMeta } = await loadLazyAuth();
    expect(securitySchemesFor("query-docs")).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["profile", "email"] },
    ]);
    expect(toolAuthMeta("query-docs")).toEqual({
      securitySchemes: securitySchemesFor("query-docs"),
    });
  });

  test("protected tools advertise oauth2 only", async () => {
    const { securitySchemesFor } = await loadLazyAuth({
      CONTEXT7_PROTECTED_TOOLS: "secret-tool",
    });
    expect(securitySchemesFor("secret-tool")).toEqual([
      { type: "oauth2", scopes: ["profile", "email"] },
    ]);
  });
});

describe("resolveAuthState", () => {
  const isJwt = (t: string) => t.split(".").length === 3;

  test("no credential is anonymous", async () => {
    const { resolveAuthState } = await loadLazyAuth();
    const verify = vi.fn(async () => ({ valid: true }));
    expect(await resolveAuthState(undefined, verify, isJwt)).toEqual({ authenticated: false });
    expect(verify).not.toHaveBeenCalled();
  });

  test("a valid JWT authenticates and an invalid one does not", async () => {
    const { resolveAuthState } = await loadLazyAuth();
    expect(await resolveAuthState("a.b.c", async () => ({ valid: true }), isJwt)).toMatchObject({
      authenticated: true,
    });
    expect(
      await resolveAuthState("a.b.c", async () => ({ valid: false, error: "Token expired" }), isJwt)
    ).toEqual({ authenticated: false, error: "Token expired" });
  });

  test("an opaque key is taken at face value, since only the backend can judge it", async () => {
    const { resolveAuthState } = await loadLazyAuth();
    const verify = vi.fn(async () => ({ valid: true }));
    expect(await resolveAuthState("ctx7sk-abc", verify, isJwt)).toEqual({ authenticated: true });
    expect(verify).not.toHaveBeenCalled();
  });
});
