import { afterEach, describe, expect, test, vi } from "vitest";
import { Context7 } from "./client";
import { Context7Error } from "@error";

describe("Context7 Client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("creates a client with an explicit API key", () => {
    expect(new Context7({ apiKey: "ctx7sk-config" })).toBeDefined();
  });

  test("creates a client from the environment", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "ctx7sk-environment");

    expect(new Context7()).toBeDefined();
  });

  test("requires an API key or auth token", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");

    expect(() => new Context7({ apiKey: "" })).toThrow(Context7Error);
    expect(() => new Context7()).toThrow("Authentication is required");
  });

  test("resolves a fresh OIDC token for every request", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          headers: { "content-type": "application/json" },
        })
      )
    );
    const authToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("oidc-token-1")
      .mockResolvedValueOnce("oidc-token-2");
    const client = new Context7({ authToken, fetch: fetchMock, retry: false });

    await client.searchLibrary("state management", "react");
    await client.searchLibrary("routing", "next.js");

    expect(authToken).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer oidc-token-1" }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer oidc-token-2" }),
    });
  });

  test("rejects an empty token returned by a provider", async () => {
    const fetchMock = vi.fn();
    const client = new Context7({ authToken: () => "", fetch: fetchMock });

    await expect(client.searchLibrary("routing", "next.js")).rejects.toMatchObject({
      code: "authentication_error",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("prefers the configured API key over the environment", () => {
    vi.stubEnv("CONTEXT7_API_KEY", "invalid-environment-key");
    const warn = vi.spyOn(console, "warn");

    new Context7({ apiKey: "ctx7sk-config" });

    expect(warn).not.toHaveBeenCalled();
  });

  test("works in runtimes without process when an API key is configured", () => {
    vi.stubGlobal("process", undefined);

    expect(new Context7({ apiKey: "ctx7sk-config" })).toBeDefined();
    expect(() => new Context7()).toThrow(Context7Error);
  });

  test("forwards transport configuration and protects the authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      })
    );
    const onResponse = vi.fn();
    const client = new Context7({
      apiKey: "ctx7sk-config",
      baseUrl: "https://proxy.example.com/context7/",
      cache: "force-cache",
      retry: false,
      timeout: false,
      keepAlive: false,
      fetch: fetchMock,
      headers: {
        authorization: "Bearer should-not-win",
        "X-Application": "test-suite",
      },
      onResponse,
    });

    await client.searchLibrary("state management", "react");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://proxy.example.com/context7/v2/libs/search?query=state+management&libraryName=react"
    );
    expect(init).toMatchObject({
      cache: "force-cache",
      keepalive: false,
      headers: {
        Authorization: "Bearer ctx7sk-config",
        "Content-Type": "application/json",
        "X-Application": "test-suite",
      },
    });
    expect(onResponse).toHaveBeenCalledWith({ status: 200, attempt: 0 });
  });

  test("forwards per-request cache, timeout, and abort options", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      })
    );
    const controller = new AbortController();
    const client = new Context7({
      apiKey: "ctx7sk-config",
      cache: "no-store",
      timeout: 30_000,
      fetch: fetchMock,
    });

    await client.searchLibrary("state management", "react", {
      cache: "reload",
      timeout: false,
      signal: controller.signal,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.cache).toBe("reload");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
