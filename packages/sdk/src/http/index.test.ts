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

  test("throws Context7Error (not SyntaxError) on empty application/json success body", async () => {
    mockFetch(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toBe("Failed to parse JSON response from Context7 API");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("throws Context7Error (not SyntaxError) on malformed application/json success body", async () => {
    mockFetch(
      new Response("{ invalid json }", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const error = await newClient()
      .request({ path: ["search"] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Context7Error);
    expect(error).not.toBeInstanceOf(SyntaxError);
    expect(error.message).toBe("Failed to parse JSON response from Context7 API");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("returns parsed result on valid application/json success body", async () => {
    mockFetch(
      new Response(JSON.stringify({ ok: true, items: [1, 2, 3] }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );

    const response = await newClient().request<{ ok: boolean; items: number[] }>({
      path: ["search"],
    });

    expect(response.result).toEqual({ ok: true, items: [1, 2, 3] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
