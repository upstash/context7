import { createDecipheriv } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  apiKeyHash,
  isSnapshotEnabled,
  refreshSnapshot,
  snapshotExperimentalTools,
  startExperimentalToolsSnapshot,
  stopExperimentalToolsSnapshot,
  SNAPSHOT_PATH,
} from "../src/lib/experimental-tools-snapshot.js";
import {
  resetOpaqueOAuthTokenValidation,
  validateOpaqueOAuthToken,
  validatedOpaqueOAuthTokenUserId,
} from "../src/lib/oauth-token-validation.js";

const ASSERTION_KEY = "0123456789abcdef".repeat(4);
const KEY = "ctx7sk-11111111-2222-3333-4444-555555555555";

/** An unsigned JWT: the snapshot reads `sub` only after the auth gate verified the token. */
const jwt = (header: object, payload: object) =>
  [header, payload, "sig"]
    .map((part) =>
      Buffer.from(typeof part === "string" ? part : JSON.stringify(part)).toString("base64url")
    )
    .join(".");
const clerkJwt = (sub: string) =>
  jwt({ alg: "RS256", typ: "at+jwt" }, { iss: "https://clerk.context7.com", sub });
const otherJwt = (sub: string) =>
  jwt({ alg: "RS256" }, { iss: "https://login.microsoftonline.com/x", sub });

/** Opens the assertion the way the app does (`openMcpAssertion("s1", …)`). */
function openAssertion(assertion: string): string | null {
  const [tag, timestamp, nonce, sealed] = assertion.split(":");
  if (tag !== "s1") return null;
  const bytes = Buffer.from(sealed, "hex");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ASSERTION_KEY, "hex"),
    Buffer.from(nonce, "hex")
  );
  decipher.setAAD(Buffer.from(`${tag}:${timestamp}`));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString();
}

/** A stand-in for the app's snapshot endpoint. */
function fakeApp() {
  const state = {
    version: "1",
    users: {
      user_a: { all: false, tools: ["query-code", "unknown-tool"] },
      user_all: { all: true, tools: [] },
      user_bad: "not a choice",
    } as Record<string, unknown>,
    apiKeys: { [apiKeyHash(KEY)]: "user_a" } as Record<string, string>,
    down: false,
    full: 0,
    notModified: 0,
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (state.down) throw new TypeError("fetch failed");
    expect(String(url)).toMatch(new RegExp(`${SNAPSHOT_PATH}$`));
    const headers = new Headers(init?.headers);
    if (
      openAssertion(headers.get("X-Context7-Mcp-Assertion") ?? "") !== "experimental-tools-snapshot"
    ) {
      return new Response(null, { status: 401 });
    }
    if (headers.get("If-None-Match") === `"${state.version}"`) {
      state.notModified++;
      return new Response(null, { status: 304 });
    }
    state.full++;
    const { version, users, apiKeys } = state;
    return new Response(JSON.stringify({ version, users, apiKeys }), { status: 200 });
  });
  return { state, fetchMock };
}

beforeEach(() => {
  vi.stubEnv("MCP_CLIENT_IP_ASSERTION_KEY", ASSERTION_KEY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopExperimentalToolsSnapshot();
  resetOpaqueOAuthTokenValidation();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("experimental tools snapshot", () => {
  test("is on only for a process with the shared assertion key", async () => {
    vi.stubEnv("MCP_CLIENT_IP_ASSERTION_KEY", "");
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    expect(isSnapshotEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers from memory for every credential kind", async () => {
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    expect(isSnapshotEnabled()).toBe(true);
    const calls = fetchMock.mock.calls.length;

    expect(snapshotExperimentalTools(KEY)).toEqual(["code-tools"]);
    expect(snapshotExperimentalTools(clerkJwt("user_all"))).toEqual([
      "code-tools",
      "get-upgrade-guide",
      "submit-docs-feedback",
    ]);
    expect(snapshotExperimentalTools(clerkJwt("user_bad"))).toEqual([]);
    expect(snapshotExperimentalTools(clerkJwt("nobody"))).toEqual([]);
    expect(snapshotExperimentalTools(otherJwt("user_all"))).toEqual([]);
    expect(snapshotExperimentalTools("ctx7sk-unknown")).toEqual([]);
    expect(snapshotExperimentalTools(undefined)).toEqual([]);
    // Reading the snapshot never calls out.
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  test("reads the whole snapshot again only after it changed", async () => {
    const { state, fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    await refreshSnapshot();
    await refreshSnapshot();
    expect(state.full).toBe(1);
    expect(state.notModified).toBe(2);

    state.users.user_a = { all: true, tools: [] };
    state.version = "2";
    await refreshSnapshot();
    expect(state.full).toBe(2);
    expect(snapshotExperimentalTools(KEY)).toHaveLength(3);
  });

  test("keeps serving the last snapshot while the app is down", async () => {
    const { state, fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    state.down = true;
    for (let i = 0; i < 5; i++) await refreshSnapshot();
    expect(snapshotExperimentalTools(KEY)).toEqual(["code-tools"]);
    // Only the first failures of a streak are logged.
    expect(vi.mocked(console.error).mock.calls).toHaveLength(3);
    state.down = false;
    await refreshSnapshot();
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toContain(
      "read again after 5 failures"
    );
  });

  test("lists nothing until the first read succeeds", async () => {
    const { state, fetchMock } = fakeApp();
    state.down = true;
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    expect(snapshotExperimentalTools(KEY)).toEqual([]);
    state.down = false;
    await refreshSnapshot();
    expect(snapshotExperimentalTools(KEY)).toEqual(["code-tools"]);
  });
});

describe("opaque OAuth token user", () => {
  test("comes from the auth check while its valid verdict is cached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(null, { status: 204, headers: { "X-Context7-User-Id": "user_a" } })
      )
    );
    expect(validatedOpaqueOAuthTokenUserId("oat_x")).toBeUndefined();
    await validateOpaqueOAuthToken("oat_x", 1_000);
    expect(validatedOpaqueOAuthTokenUserId("oat_x", 1_000)).toBe("user_a");
    expect(validatedOpaqueOAuthTokenUserId("oat_x", 1_000 + 61_000)).toBeUndefined();
  });

  test("finds the token's tools in the snapshot", async () => {
    const { fetchMock } = fakeApp();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot();
    expect(snapshotExperimentalTools("oat_z")).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(null, { status: 204, headers: { "X-Context7-User-Id": "user_a" } })
      )
    );
    await validateOpaqueOAuthToken("oat_z");
    expect(snapshotExperimentalTools("oat_z")).toEqual(["code-tools"]);
  });

  test("is unknown when the app does not name it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    await validateOpaqueOAuthToken("oat_y", 1_000);
    expect(validatedOpaqueOAuthTokenUserId("oat_y", 1_000)).toBeUndefined();
  });
});
