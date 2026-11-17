import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchExperimentalTools } from "../src/lib/api.js";
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

    // The choice expired and the app is down: keep it, and ask again after 15 seconds.
    now.mockReturnValue(start + 61_000);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));

    now.mockReturnValue(start + 70_000);
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + 77_000);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["query-code"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
