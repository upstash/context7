import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchExperimentalTools } from "../src/lib/api.js";
import { experimentalToolsFromChoice } from "../src/lib/tool-names.js";
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
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["code-tools"]);

    // The choice expired (5 minutes) and the app is down: keep it, and ask again after 2 minutes.
    now.mockReturnValue(start + 301_000);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["code-tools"]);
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("HTTP 500"));

    now.mockReturnValue(start + 400_000);
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockReturnValue(start + 422_000);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await fetchExperimentalTools(context, onFailure)).toEqual(["code-tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    fetchMock.mockResolvedValueOnce(choice(["code-tools"]));
    const context = { apiKey: "ctx7sk-parallel" };
    const lists = await Promise.all([1, 2, 3].map(() => fetchExperimentalTools(context)));
    expect(lists).toEqual([["code-tools"], ["code-tools"], ["code-tools"]]);
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

describe("experimentalToolsFromChoice", () => {
  test("expands all and keeps only known tools", () => {
    expect(experimentalToolsFromChoice({ all: true, tools: [] })).toEqual([
      "code-tools",
      "get-upgrade-guide",
      "submit-docs-feedback",
    ]);
    expect(experimentalToolsFromChoice({ all: false, tools: ["query-code", "nope"] })).toEqual([
      "code-tools",
    ]);
    // The app stores the new id, code-tools, once its rename is live.
    expect(experimentalToolsFromChoice({ all: false, tools: ["code-tools"] })).toEqual([
      "code-tools",
    ]);
    expect(experimentalToolsFromChoice(null)).toEqual([]);
    expect(experimentalToolsFromChoice("all")).toEqual([]);
  });
});
