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
  test("includes resource_metadata and scope, and error when challenging", async () => {
    const { buildWwwAuthenticate } = await loadModule(BASE_ENV);
    const base = "https://mcp.context7.com";
    expect(buildWwwAuthenticate(base)).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
    expect(buildWwwAuthenticate(base, "invalid_token")).toBe(
      `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource", scope="profile email"`
    );
  });
});
