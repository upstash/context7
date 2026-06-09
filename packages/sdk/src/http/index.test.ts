import { describe, test, expect, vi, afterEach } from "vitest";
import { HttpClient } from "./index";
import { Context7Error } from "@error";

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
  });

  test("throws Context7Error with message from JSON error body", async () => {
    mockFetch(
      new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(newClient().request({ path: ["search"] })).rejects.toThrowError(
      new Context7Error("rate limit exceeded")
    );
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

  test("falls back to statusText on empty error body", async () => {
    mockFetch(new Response("", { status: 503, statusText: "Service Unavailable" }));

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error.message).toBe("Service Unavailable");
  });
});

function newRetryClient(): HttpClient {
  return new HttpClient({
    baseUrl: "https://example.com/api",
    retry: { retries: 2, backoff: () => 0 },
  });
}

function mockFetchSequence(responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("error", { status, headers });
}

describe("HttpClient retry on transient HTTP errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("retries on 429 then succeeds", async () => {
    const fetchMock = mockFetchSequence([errorResponse(429), jsonOk({ ok: true })]);

    const { result } = await newRetryClient().request({ path: ["search"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  test("retries on 5xx server errors then succeeds", async () => {
    const fetchMock = mockFetchSequence([errorResponse(503), jsonOk({ ok: true })]);

    const { result } = await newRetryClient().request({ path: ["search"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  test("does not retry on 4xx client errors", async () => {
    const fetchMock = mockFetchSequence([errorResponse(400), jsonOk({ ok: true })]);

    await expect(newRetryClient().request({ path: ["search"] })).rejects.toBeInstanceOf(
      Context7Error
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("exhausts retries on persistent 500", async () => {
    const fetchMock = mockFetchSequence([
      errorResponse(500),
      errorResponse(500),
      errorResponse(500),
    ]);

    await expect(newRetryClient().request({ path: ["search"] })).rejects.toBeInstanceOf(
      Context7Error
    );
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test("respects Retry-After header on 429", async () => {
    const fetchMock = mockFetchSequence([
      errorResponse(429, { "retry-after": "0" }),
      jsonOk({ ok: true }),
    ]);

    const { result } = await newRetryClient().request({ path: ["search"] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  test("retry: false performs a single attempt", async () => {
    const fetchMock = mockFetchSequence([errorResponse(500), jsonOk({ ok: true })]);

    await expect(newClient().request({ path: ["search"] })).rejects.toBeInstanceOf(Context7Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
