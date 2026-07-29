import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// In-memory stand-in for the Upstash Redis counter used by the quota gate.
const store = new Map<string, number>();
const incr = vi.fn(async (key: string) => {
  const next = (store.get(key) ?? 0) + 1;
  store.set(key, next);
  return next;
});
const expire = vi.fn(async () => 1);

vi.mock("../src/lib/redis.js", () => ({
  getRedis: () => ({ incr, expire }),
}));

// JWTs are only relevant for the authenticated-bypass path; treat any 3-part
// token as valid so we can exercise the bypass without real crypto.
vi.mock("../src/lib/jwt.js", () => ({
  isJWT: (t: string) => t.split(".").length === 3,
  validateJWT: vi.fn(async () => ({ valid: true })),
}));

async function loadModule(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  store.clear();
  incr.mockClear();
  expire.mockClear();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import("../src/lib/auth/lazy-auth.js");
}

function toolCall(name: string, id: unknown = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: {} } };
}

const BASE_ENV = {
  CONTEXT7_PROTECTED_TOOLS: undefined,
  CONTEXT7_ANON_FREE_CALLS: undefined,
};

beforeEach(() => {
  process.env.CONTEXT7_PROTECTED_TOOLS = undefined;
  process.env.CONTEXT7_ANON_FREE_CALLS = undefined;
});

afterEach(() => {
  delete process.env.CONTEXT7_PROTECTED_TOOLS;
  delete process.env.CONTEXT7_ANON_FREE_CALLS;
});

describe("toolCallsIn", () => {
  test("extracts tool names from a single message and a batch", async () => {
    const { toolCallsIn } = await loadModule(BASE_ENV);
    expect(toolCallsIn(toolCall("query-docs"))).toEqual(["query-docs"]);
    expect(toolCallsIn([toolCall("a"), { method: "tools/list" }, toolCall("b")])).toEqual([
      "a",
      "b",
    ]);
  });

  test("ignores non-tools/call methods", async () => {
    const { toolCallsIn } = await loadModule(BASE_ENV);
    expect(toolCallsIn({ method: "initialize" })).toEqual([]);
    expect(toolCallsIn({ method: "tools/list" })).toEqual([]);
  });
});

describe("evaluateLazyAuth — pass-through", () => {
  test("initialize and tools/list always pass, even anonymously", async () => {
    const { evaluateLazyAuth } = await loadModule(BASE_ENV);
    const auth = { authenticated: false };
    expect(
      (await evaluateLazyAuth({ body: { method: "initialize" }, auth, clientIp: "1.1.1.1" }))
        .challenge
    ).toBeUndefined();
    expect(
      (await evaluateLazyAuth({ body: { method: "tools/list" }, auth, clientIp: "1.1.1.1" }))
        .challenge
    ).toBeUndefined();
  });

  test("authenticated callers bypass both gates", async () => {
    const { evaluateLazyAuth } = await loadModule({
      CONTEXT7_PROTECTED_TOOLS: "secret-tool",
      CONTEXT7_ANON_FREE_CALLS: "0",
    });
    const decision = await evaluateLazyAuth({
      body: toolCall("secret-tool"),
      auth: { authenticated: true },
      clientIp: "1.1.1.1",
    });
    expect(decision.challenge).toBeUndefined();
  });
});

describe("evaluateLazyAuth — protected tools", () => {
  test("anonymous call to a protected tool is challenged with 401", async () => {
    const { evaluateLazyAuth } = await loadModule({ CONTEXT7_PROTECTED_TOOLS: "secret-tool" });
    const decision = await evaluateLazyAuth({
      body: toolCall("secret-tool", 42),
      auth: { authenticated: false },
      clientIp: "1.1.1.1",
    });
    expect(decision.challenge).toMatchObject({ status: 401, error: "invalid_token", id: 42 });
  });

  test("protected-tool challenge does not consume anonymous quota", async () => {
    const { evaluateLazyAuth } = await loadModule({
      CONTEXT7_PROTECTED_TOOLS: "secret-tool",
      CONTEXT7_ANON_FREE_CALLS: "5",
    });
    await evaluateLazyAuth({
      body: toolCall("secret-tool"),
      auth: { authenticated: false },
      clientIp: "1.1.1.1",
    });
    expect(incr).not.toHaveBeenCalled();
  });

  test("public tools stay anonymous when no protected set is configured", async () => {
    const { evaluateLazyAuth } = await loadModule(BASE_ENV);
    const decision = await evaluateLazyAuth({
      body: toolCall("query-docs"),
      auth: { authenticated: false },
      clientIp: "1.1.1.1",
    });
    expect(decision.challenge).toBeUndefined();
  });
});

describe("evaluateLazyAuth — anonymous quota", () => {
  test("allows the free allowance then challenges", async () => {
    const { evaluateLazyAuth } = await loadModule({ CONTEXT7_ANON_FREE_CALLS: "3" });
    const call = () =>
      evaluateLazyAuth({
        body: toolCall("query-docs"),
        auth: { authenticated: false },
        clientIp: "9.9.9.9",
      });

    for (let i = 0; i < 3; i++) {
      expect((await call()).challenge).toBeUndefined();
    }
    const fourth = await call();
    expect(fourth.challenge).toMatchObject({ status: 401, error: "invalid_token" });
    expect(expire).toHaveBeenCalledTimes(1); // TTL set once, on the first hit
  });

  test("quota is per-client", async () => {
    const { evaluateLazyAuth } = await loadModule({ CONTEXT7_ANON_FREE_CALLS: "1" });
    const callFrom = (ip: string) =>
      evaluateLazyAuth({
        body: toolCall("query-docs"),
        auth: { authenticated: false },
        clientIp: ip,
      });

    expect((await callFrom("1.1.1.1")).challenge).toBeUndefined();
    expect((await callFrom("1.1.1.1")).challenge).toBeDefined();
    // A different client still has its full allowance.
    expect((await callFrom("2.2.2.2")).challenge).toBeUndefined();
  });

  test("CONTEXT7_ANON_FREE_CALLS=0 disables the quota gate", async () => {
    const { evaluateLazyAuth } = await loadModule({ CONTEXT7_ANON_FREE_CALLS: "0" });
    for (let i = 0; i < 10; i++) {
      const decision = await evaluateLazyAuth({
        body: toolCall("query-docs"),
        auth: { authenticated: false },
        clientIp: "5.5.5.5",
      });
      expect(decision.challenge).toBeUndefined();
    }
    expect(incr).not.toHaveBeenCalled();
  });
});

describe("buildWwwAuthenticate", () => {
  const base = "https://mcp.context7.com";

  test("includes resource_metadata and scope, and error when challenging", async () => {
    const { buildWwwAuthenticate } = await loadModule(BASE_ENV);
    expect(buildWwwAuthenticate(base)).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
    expect(buildWwwAuthenticate(base, "invalid_token")).toBe(
      `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
  });

  test("carries error_description, which ChatGPT needs to recognise an auth failure", async () => {
    const { buildWwwAuthenticate } = await loadModule(BASE_ENV);
    expect(buildWwwAuthenticate(base, "invalid_token", "Please sign in")).toBe(
      `Bearer error="invalid_token", error_description="Please sign in", ` +
        `resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
  });

  test("strips quotes and newlines that would break header parsing", async () => {
    const { buildWwwAuthenticate } = await loadModule(BASE_ENV);
    const header = buildWwwAuthenticate(base, "invalid_token", 'say "hi"\nthen  bye');
    expect(header).toContain('error_description="say hi then bye"');
  });

  test("omits error_description when there is no error to describe", async () => {
    const { buildWwwAuthenticate } = await loadModule(BASE_ENV);
    expect(buildWwwAuthenticate(base, undefined, "ignored")).not.toContain("error_description");
  });
});

describe("challengeTransportFor", () => {
  test("defaults to the spec-compliant 401 for unknown and missing clients", async () => {
    const { challengeTransportFor } = await loadModule(BASE_ENV);
    expect(challengeTransportFor(undefined)).toBe("http-401");
    expect(challengeTransportFor("claude-code/2.1.0")).toBe("http-401");
    expect(challengeTransportFor("node")).toBe("http-401");
    expect(challengeTransportFor("Visual Studio Code/1.108.0")).toBe("http-401");
    expect(challengeTransportFor("Cursor/1.9.2")).toBe("http-401");
  });

  test("selects the tool-result form for OpenAI clients, case-insensitively", async () => {
    const { challengeTransportFor } = await loadModule(BASE_ENV);
    expect(challengeTransportFor("openai-mcp/1.0")).toBe("tool-result");
    expect(challengeTransportFor("ChatGPT/1.2025.0")).toBe("tool-result");
    expect(challengeTransportFor("codex_cli_rs/0.104.0")).toBe("tool-result");
  });

  test("the client list is overridable for clients that change their UA", async () => {
    const { challengeTransportFor } = await loadModule({
      ...BASE_ENV,
      CONTEXT7_TOOL_RESULT_CHALLENGE_CLIENTS: "some-new-client",
    });
    expect(challengeTransportFor("some-new-client/1.0")).toBe("tool-result");
    expect(challengeTransportFor("codex_cli_rs/0.104.0")).toBe("http-401");
  });
});

describe("challenge bodies", () => {
  const base = "https://mcp.context7.com";
  const challenge = {
    status: 401 as const,
    error: "invalid_token" as const,
    message: "Anonymous usage limit reached.",
    id: 7,
  };

  test("http form is a JSON-RPC error echoing the request id", async () => {
    const { buildHttpChallenge } = await loadModule(BASE_ENV);
    expect(buildHttpChallenge(challenge)).toEqual({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Anonymous usage limit reached." },
      id: 7,
    });
  });

  test("http form sends a null id when the request had none", async () => {
    const { buildHttpChallenge } = await loadModule(BASE_ENV);
    expect(buildHttpChallenge({ ...challenge, id: null }).id).toBeNull();
  });

  test("tool-result form is a failed tool call carrying the challenge in _meta", async () => {
    const { buildToolResultChallenge } = await loadModule(BASE_ENV);
    const body = buildToolResultChallenge(challenge, base);
    expect(body.id).toBe(7);
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
    const { securitySchemesFor } = await loadModule(BASE_ENV);
    expect(securitySchemesFor("query-docs")).toEqual([
      { type: "noauth" },
      { type: "oauth2", scopes: ["profile", "email"] },
    ]);
  });

  test("protected tools advertise oauth2 only", async () => {
    const { securitySchemesFor } = await loadModule({ CONTEXT7_PROTECTED_TOOLS: "secret-tool" });
    expect(securitySchemesFor("secret-tool")).toEqual([
      { type: "oauth2", scopes: ["profile", "email"] },
    ]);
  });
});
