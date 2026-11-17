import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  apiKeyHash,
  isSnapshotLoaded,
  refreshSnapshot,
  snapshotExperimentalTools,
  snapshotSourceFromEnv,
  startExperimentalToolsSnapshot,
  stopExperimentalToolsSnapshot,
  SNAPSHOT_ENTRIES_KEY,
  SNAPSHOT_VERSION_KEY,
} from "../src/lib/experimental-tools-snapshot.js";
import {
  resetOpaqueOAuthTokenValidation,
  validateOpaqueOAuthToken,
  validatedOpaqueOAuthTokenUserId,
} from "../src/lib/oauth-token-validation.js";

const SOURCE = { url: "https://redis.test", token: "read-only" };
const KEY = "ctx7sk-11111111-2222-3333-4444-555555555555";

/** A stand-in for the Upstash REST API holding one snapshot. */
function fakeRedis() {
  const state = {
    version: "1",
    entries: {
      "u:user_a": JSON.stringify({ all: false, tools: ["query-code", "unknown-tool"] }),
      "u:user_all": JSON.stringify({ all: true, tools: [] }),
      "u:user_bad": "{not json",
      [`k:${apiKeyHash(KEY)}`]: "user_a",
    } as Record<string, string>,
    /** Bumps the version between the two version reads of the next pipeline. */
    changeDuringRead: false,
    down: false,
    hgetalls: 0,
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (state.down) throw new TypeError("fetch failed");
    const body = JSON.parse(String(init?.body));
    const run = ([cmd, key]: string[]) => {
      if (cmd === "GET" && key === SNAPSHOT_VERSION_KEY) return { result: state.version };
      if (cmd === "HGETALL" && key === SNAPSHOT_ENTRIES_KEY) {
        state.hgetalls++;
        if (state.changeDuringRead) {
          state.version = String(Number(state.version) + 1);
          state.changeDuringRead = false;
        }
        return { result: Object.entries(state.entries).flat() };
      }
      return { error: `unexpected ${cmd} ${key}` };
    };
    const reply = String(url).endsWith("/pipeline") ? body.map(run) : run(body);
    return new Response(JSON.stringify(reply), { status: 200 });
  });
  return { state, fetchMock };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopExperimentalToolsSnapshot();
  resetOpaqueOAuthTokenValidation();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("experimental tools snapshot", () => {
  test("is configured only with both variables", () => {
    expect(snapshotSourceFromEnv({})).toBeUndefined();
    expect(
      snapshotSourceFromEnv({ MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL: "https://x/" })
    ).toBeUndefined();
    expect(
      snapshotSourceFromEnv({
        MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL: "https://x/",
        MCP_EXPERIMENTAL_TOOLS_REDIS_REST_TOKEN: "t",
      })
    ).toEqual({ url: "https://x", token: "t" });
  });

  test("answers from memory for API keys and user ids", async () => {
    const { fetchMock } = fakeRedis();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot(SOURCE);
    const calls = fetchMock.mock.calls.length;

    expect(snapshotExperimentalTools({ apiKey: KEY })).toEqual(["query-code"]);
    expect(snapshotExperimentalTools({ userId: "user_a" })).toEqual(["query-code"]);
    expect(snapshotExperimentalTools({ userId: "user_all" })).toEqual([
      "query-code",
      "get-upgrade-guide",
      "submit-docs-feedback",
    ]);
    expect(snapshotExperimentalTools({ userId: "user_bad" })).toEqual([]);
    expect(snapshotExperimentalTools({ apiKey: "ctx7sk-unknown" })).toEqual([]);
    expect(snapshotExperimentalTools({ userId: "nobody" })).toEqual([]);
    // Reading the snapshot never calls out.
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  test("reads the entries again only after the version changes", async () => {
    const { state, fetchMock } = fakeRedis();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot(SOURCE);
    await refreshSnapshot();
    await refreshSnapshot();
    expect(state.hgetalls).toBe(1);

    state.entries["u:user_a"] = JSON.stringify({ all: true, tools: [] });
    state.version = "2";
    await refreshSnapshot();
    expect(state.hgetalls).toBe(2);
    expect(snapshotExperimentalTools({ apiKey: KEY })).toHaveLength(3);
  });

  test("keeps the last snapshot when a change lands during the read", async () => {
    const { state, fetchMock } = fakeRedis();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot(SOURCE);

    state.version = "2";
    state.entries["u:user_a"] = JSON.stringify({ all: true, tools: [] });
    state.changeDuringRead = true;
    await refreshSnapshot();
    expect(snapshotExperimentalTools({ apiKey: KEY })).toEqual(["query-code"]);

    await refreshSnapshot();
    expect(snapshotExperimentalTools({ apiKey: KEY })).toHaveLength(3);
  });

  test("keeps serving the last snapshot while Redis is down", async () => {
    const { state, fetchMock } = fakeRedis();
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot(SOURCE);
    state.down = true;
    for (let i = 0; i < 5; i++) await refreshSnapshot();
    expect(snapshotExperimentalTools({ apiKey: KEY })).toEqual(["query-code"]);
    // Only the first failures of a streak are logged.
    expect(vi.mocked(console.error).mock.calls).toHaveLength(3);
    state.down = false;
    await refreshSnapshot();
    expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toContain(
      "read again after 5 failures"
    );
  });

  test("lists nothing until the first read succeeds", async () => {
    const { state, fetchMock } = fakeRedis();
    state.down = true;
    vi.stubGlobal("fetch", fetchMock);
    await startExperimentalToolsSnapshot(SOURCE);
    expect(isSnapshotLoaded()).toBe(false);
    expect(snapshotExperimentalTools({ apiKey: KEY })).toEqual([]);
    state.down = false;
    await refreshSnapshot();
    expect(snapshotExperimentalTools({ apiKey: KEY })).toEqual(["query-code"]);
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

  test("is unknown when the app does not name it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    await validateOpaqueOAuthToken("oat_y", 1_000);
    expect(validatedOpaqueOAuthTokenUserId("oat_y", 1_000)).toBeUndefined();
  });
});
