import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchExperimentalTools } from "../src/lib/api.js";
import { experimentalToolsLookupFor } from "../src/lib/tool-names.js";
import { isOAuthTokenRememberedInvalid } from "../src/lib/oauth-token-validation.js";

const fetchMock = vi.fn<typeof fetch>();
const choice = (tools: string[]) =>
  new Response(JSON.stringify({ all: false, tools }), {
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchExperimentalTools", () => {
  test("keeps the last known choice when a later lookup fails", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const context = { apiKey: "ctx7sk-stale", transport: "http" as const };
    const onFailure = vi.fn();

    fetchMock.mockResolvedValueOnce(choice(["query-code"]));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);

    // The choice expired (5 minutes) and the app is down: keep it, and ask again after 2 minutes.
    now.mockReturnValue(start + 301_000);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));

    now.mockReturnValue(start + 400_000);
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + 422_000);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("asks only when its lookup mode allows it", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const context = { apiKey: "ctx7sk-modes" };

    // never: none, and no call.
    expect(await fetchExperimentalTools(context, undefined, { lookUp: "never" })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    // missing: asks once, then reuses the choice even after it expired.
    fetchMock.mockResolvedValueOnce(choice(["query-code"]));
    expect(await fetchExperimentalTools(context, undefined, { lookUp: "missing" })).toEqual([
      "query-code",
    ]);
    now.mockReturnValue(start + 3_600_000);
    expect(await fetchExperimentalTools(context, undefined, { lookUp: "missing" })).toEqual([
      "query-code",
    ]);
    expect(await fetchExperimentalTools(context, undefined, { lookUp: "never" })).toEqual([
      "query-code",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // expired: the tool list refreshes it.
    fetchMock.mockResolvedValueOnce(choice([]));
    expect(await fetchExperimentalTools(context)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("serves from the cache instead of starting more than 32 lookups at once", async () => {
    let release!: () => void;
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(choice([]));
    });
    fetchMock.mockReturnValue(pending);
    const lookups = Array.from({ length: 40 }, (_, i) =>
      fetchExperimentalTools({ apiKey: `ctx7sk-burst-${i}` })
    );
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(32));
    } finally {
      release();
    }
    expect(await Promise.all(lookups)).toEqual(Array.from({ length: 40 }, () => []));
    expect(fetchMock).toHaveBeenCalledTimes(32);
  });

  test("reports a failed lookup once, not once per waiting request", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const onFailure = vi.fn();
    const context = { apiKey: "ctx7sk-shared-failure" };
    await Promise.all([1, 2, 3].map(() => fetchExperimentalTools(context, onFailure)));
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  test("lists none when a credential's first lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await fetchExperimentalTools({ apiKey: "ctx7sk-new" }, () => {})).toEqual([]);
  });

  test("makes one call for parallel requests of one credential", async () => {
    fetchMock.mockResolvedValueOnce(choice(["query-code"]));
    const context = { apiKey: "ctx7sk-parallel" };
    const lists = await Promise.all([1, 2, 3].map(() => fetchExperimentalTools(context)));
    expect(lists).toEqual([["query-code"], ["query-code"], ["query-code"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("remembers an OAuth token the app rejects so the next request is challenged", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_oauth_token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    await fetchExperimentalTools({ apiKey: "oat_expired-settings", transport: "http" }, () => {});
    expect(isOAuthTokenRememberedInvalid("oat_expired-settings")).toBe(true);
  });
});

describe("experimentalToolsLookupFor", () => {
  const call = (name: string) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name },
  });
  const request = (method: string) => ({ jsonrpc: "2.0", id: 1, method });

  test("refreshes an expired choice for the tool list", () => {
    expect(experimentalToolsLookupFor(request("tools/list"))).toBe("expired");
    expect(experimentalToolsLookupFor(request("server/discover"))).toBe("expired");
    expect(experimentalToolsLookupFor([call("query-docs"), request("tools/list")])).toBe("expired");
  });

  test("asks for initialize and experimental tool calls only without a choice", () => {
    expect(experimentalToolsLookupFor(request("initialize"))).toBe("missing");
    expect(experimentalToolsLookupFor(call("query-code"))).toBe("missing");
    expect(experimentalToolsLookupFor([call("query-docs"), call("get-upgrade-guide")])).toBe(
      "missing"
    );
  });

  test("never asks for core tool calls, notifications or malformed bodies", () => {
    expect(experimentalToolsLookupFor(call("query-docs"))).toBe("never");
    expect(experimentalToolsLookupFor(call("resolve-library-id"))).toBe("never");
    expect(
      experimentalToolsLookupFor({ jsonrpc: "2.0", method: "notifications/initialized" })
    ).toBe("never");
    expect(experimentalToolsLookupFor(request("ping"))).toBe("never");
    expect(experimentalToolsLookupFor(undefined)).toBe("never");
    expect(experimentalToolsLookupFor("tools/list")).toBe("never");
    expect(experimentalToolsLookupFor({ method: "tools/call", params: null })).toBe("never");
  });
});
