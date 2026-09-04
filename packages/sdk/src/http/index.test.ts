import { describe, test, expect, vi, afterEach } from "vitest";
import { HttpClient } from "./index";
import { Context7Error, Context7JSONParseError, Context7UrlError } from "@error";

function newClient(): HttpClient {
  return new HttpClient({
    baseUrl: "https://example.com/api",
    retry: false,
  });
}

function mockFetch(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

describe("HttpClient error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("does not retry network errors when retries are disabled", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error).toMatchObject({
      message: "network unavailable",
      code: "network_error",
      retryable: true,
    });
    expect(error.cause).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("retries transient HTTP responses and reports every attempt", async () => {
    const onResponse = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req-success" },
        })
      );
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 1, backoff: () => 0 },
      onResponse,
    });

    await expect(client.request({ method: "GET", path: ["search"] })).resolves.toEqual({
      result: { ok: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onResponse).toHaveBeenNthCalledWith(1, { status: 503, attempt: 0 });
    expect(onResponse).toHaveBeenNthCalledWith(2, {
      status: 200,
      attempt: 1,
      requestId: "req-success",
    });
  });

  test("honors Retry-After before retrying a rate-limited request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "1" } })
      )
      .mockResolvedValueOnce(new Response("ok"));
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 1, backoff: () => 0 },
      timeout: false,
    });

    const request = client.request({ method: "GET", path: ["search"] });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toEqual({ result: "ok", headers: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("uses the last failure when a retry later fails on the network", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockRejectedValueOnce(new Error("connection reset"));
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 1, backoff: () => 0 },
    });

    const error = await client.request({ method: "GET", path: ["search"] }).catch((e) => e);

    expect(error).toMatchObject({ code: "network_error", message: "connection reset" });
  });

  test("does not retry POST requests unless explicitly configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 3, backoff: () => 0 },
    });

    await expect(client.request({ method: "POST", path: ["refresh"] })).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("times out a request without retrying after the abort", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      timeout: 25,
    });

    const request = client.request({ path: ["search"] }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(25);
    const error = await request;

    expect(error).toMatchObject({
      code: "request_timeout",
      message: "Request timed out",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("reports a timeout when the deadline expires during retry backoff", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 1, backoff: () => 1_000 },
      timeout: 25,
    });

    const request = client.request({ method: "GET", path: ["search"] }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(25);
    const error = await request;

    expect(error).toMatchObject({
      code: "request_timeout",
      message: "Request timed out",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("honors a per-request abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      timeout: false,
    });

    const request = client.request({ path: ["search"], signal: controller.signal }).catch((e) => e);
    controller.abort();
    const error = await request;

    expect(error).toMatchObject({
      code: "request_aborted",
      message: "Request was aborted",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("does not call fetch for a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      timeout: false,
    });

    const error = await client
      .request({ path: ["search"], signal: controller.signal })
      .catch((e) => e);

    expect(error).toMatchObject({ code: "request_aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not treat response observer failures as network failures", async () => {
    const observerError = new Error("observer failed");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      fetch: fetchMock,
      retry: { retries: 3, backoff: () => 0 },
      onResponse: () => {
        throw observerError;
      },
    });

    await expect(client.request({ path: ["search"] })).rejects.toBe(observerError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("throws Context7Error with message from JSON error body", async () => {
    mockFetch(
      new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error).toMatchObject({
      message: "rate limit exceeded",
      code: "rate limit exceeded",
      status: 429,
      retryable: true,
    });
  });

  test("falls back to message field when error field is absent", async () => {
    mockFetch(
      new Response(JSON.stringify({ message: "something went wrong" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error.message).toBe("something went wrong");
  });

  test("includes status, error code, request ID, and rate limits on API errors", async () => {
    mockFetch(
      new Response(JSON.stringify({ error: "rate_limit_exceeded", message: "Try again later" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-123",
          "ratelimit-limit": "100",
          "ratelimit-remaining": "0",
          "ratelimit-reset": "1700000000",
          "retry-after": "12",
        },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toMatchObject({
      message: "Try again later",
      code: "rate_limit_exceeded",
      status: 429,
      requestId: "req-123",
      rateLimit: {
        limit: 100,
        remaining: 0,
        reset: 1700000000,
        retryAfter: 12,
      },
    });
  });

  test("throws Context7Error (not SyntaxError) on non-JSON error body", async () => {
    mockFetch(
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toBe("Bad Gateway");
  });

  test("throws a structured parse error for malformed JSON responses", async () => {
    const body = "{" + "x".repeat(250);
    mockFetch(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7JSONParseError);
    expect(error).toMatchObject({
      code: "invalid_json_response",
      status: 200,
      requestId: "req-json",
    });
    expect(error.message).toHaveLength("Unable to parse response body: ".length + 203);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  test("keeps HTTP metadata when an error response contains malformed JSON", async () => {
    mockFetch(
      new Response("{invalid", {
        status: 502,
        headers: { "content-type": "application/json", "x-request-id": "req-bad-json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7JSONParseError);
    expect(error).toMatchObject({
      code: "invalid_json_response",
      status: 502,
      requestId: "req-bad-json",
      retryable: true,
    });
  });

  test("rejects invalid base URLs", () => {
    expect(() => new HttpClient({ baseUrl: "example.com" })).toThrow(Context7UrlError);
    expect(() => new HttpClient({ baseUrl: "ftp://example.com" })).toThrow(Context7UrlError);
    expect(() => new HttpClient({ baseUrl: " https://example.com" })).toThrow(Context7UrlError);
    expect(() => new HttpClient({ baseUrl: "https://example.com\n" })).toThrow(Context7UrlError);
  });

  test("allows keepalive to be disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    const client = new HttpClient({
      baseUrl: "https://example.com",
      fetch: fetchMock,
      retry: false,
      keepAlive: false,
    });

    await client.request({ path: ["search"] });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/search",
      expect.objectContaining({ keepalive: false })
    );
  });

  test("falls back to statusText on empty error body", async () => {
    mockFetch(new Response("", { status: 503, statusText: "Service Unavailable" }));

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error.message).toBe("Service Unavailable");
  });

  test("validates timeout and retry configuration", () => {
    expect(() => new HttpClient({ baseUrl: "https://example.com", timeout: 0 })).toThrowError(
      "timeout must be a positive number or false"
    );
    expect(
      () => new HttpClient({ baseUrl: "https://example.com", retry: { retries: -1 } })
    ).toThrowError("retry.retries must be a non-negative integer");
  });
});
