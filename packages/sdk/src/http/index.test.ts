import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient } from "./index";
import { Context7Error } from "@error";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createClient(options?: { retries?: number; backoff?: (n: number) => number }) {
  return new HttpClient({
    baseUrl: "https://api.example.com",
    headers: { Authorization: "Bearer test-key" },
    retry: {
      retries: options?.retries ?? 2,
      backoff: options?.backoff ?? (() => 1), // 1ms backoff for fast tests
    },
    cache: "no-store",
  });
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : `Error ${status}`,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(body: string, status = 200, headers?: Record<string, string>) {
  return new Response(body, {
    status,
    statusText: status === 200 ? "OK" : `Error ${status}`,
    headers: { "content-type": "text/plain", ...headers },
  });
}

function htmlResponse(body: string, status = 502) {
  return new Response(body, {
    status,
    statusText: "Bad Gateway",
    headers: { "content-type": "text/html" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpClient", () => {
  describe("successful requests", () => {
    test("should return JSON response", async () => {
      const client = createClient();
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: "test" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "test" });
    });

    test("should return text response with headers", async () => {
      const client = createClient();
      mockFetch.mockResolvedValueOnce(
        textResponse("Documentation text here", 200, {
          "x-context7-page": "1",
          "x-context7-limit": "10",
          "x-context7-total-pages": "5",
          "x-context7-has-next": "true",
          "x-context7-has-prev": "false",
          "x-context7-total-tokens": "1500",
        })
      );

      const result = await client.request<string>({ method: "GET", path: ["v1", "docs"] });
      expect(result.result).toBe("Documentation text here");
      expect(result.headers).toEqual({
        page: 1,
        limit: 10,
        totalPages: 5,
        hasNext: true,
        hasPrev: false,
        totalTokens: 1500,
      });
    });

    test("should append query parameters for GET requests", async () => {
      const client = createClient();
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await client.request({
        method: "GET",
        path: ["v1", "search"],
        query: { q: "react", limit: 10, enabled: true, empty: undefined },
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("q=react");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("enabled=true");
      expect(calledUrl).not.toContain("empty");
    });
  });

  describe("error handling — non-JSON error responses", () => {
    test("should handle JSON error body", async () => {
      const client = createClient({ retries: 0 });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Invalid API key" }, 401)
      );

      try {
        await client.request({ method: "GET", path: ["v1", "test"] });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Context7Error);
        expect((e as Context7Error).message).toBe("Invalid API key");
      }
    });

    test("should handle JSON error body with message field", async () => {
      const client = createClient({ retries: 0 });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ message: "Rate limited" }, 429)
      );

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Rate limited");
    });

    test("should handle HTML error response from proxy without crashing", async () => {
      const client = createClient({ retries: 0 });
      mockFetch.mockResolvedValueOnce(
        htmlResponse("<html><body><h1>502 Bad Gateway</h1></body></html>")
      );

      // Should throw Context7Error, NOT SyntaxError from JSON.parse
      try {
        await client.request({ method: "GET", path: ["v1", "test"] });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Context7Error);
        expect(e).not.toBeInstanceOf(SyntaxError);
        // Long HTML body (>200 chars) falls back to statusText + status code
        expect((e as Context7Error).message).toContain("Bad Gateway");
      }
    });

    test("should truncate long non-JSON error bodies", async () => {
      const client = createClient({ retries: 0 });
      const longHtml = "<html>" + "x".repeat(500) + "</html>";
      mockFetch.mockResolvedValueOnce(htmlResponse(longHtml, 502));

      try {
        await client.request({ method: "GET", path: ["v1", "test"] });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Context7Error);
        // Long bodies (>200 chars) are replaced with statusText (status)
        expect((e as Context7Error).message).toContain("Bad Gateway");
        expect((e as Context7Error).message).toContain("502");
      }
    });

    test("should handle short plain text error body", async () => {
      const client = createClient({ retries: 0 });
      mockFetch.mockResolvedValueOnce(textResponse("Service Unavailable", 503));

      try {
        await client.request({ method: "GET", path: ["v1", "test"] });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(Context7Error);
        // Short plain text body (<= 200 chars) is used directly
        expect((e as Context7Error).message).toBe("Service Unavailable");
      }
    });

    test("should fall back to statusText when error body is empty", async () => {
      const client = createClient({ retries: 0 });
      mockFetch.mockResolvedValueOnce(
        new Response("", {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "text/plain" },
        })
      );

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Not Found");
    });
  });

  describe("retry logic — network errors", () => {
    test("should retry on network failure and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should exhaust retries on persistent network failure", async () => {
      const client = createClient({ retries: 2 });
      const fetchError = new TypeError("fetch failed");
      mockFetch.mockRejectedValue(fetchError);

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("fetch failed");
      // 1 initial + 2 retries = 3 total attempts
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("should not retry when abort signal fires", async () => {
      const controller = new AbortController();
      const client = new HttpClient({
        baseUrl: "https://api.example.com",
        retry: { retries: 3, backoff: () => 1 },
        signal: () => controller.signal,
      });

      const abortError = new DOMException("Aborted", "AbortError");
      mockFetch.mockRejectedValueOnce(abortError);
      controller.abort();

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("retry logic — HTTP status codes", () => {
    test("should retry on 429 and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: "Rate limited" }, 429))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should retry on 500 and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: "Internal Server Error" }, 500))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should retry on 502 and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockResolvedValueOnce(htmlResponse("<html>502</html>", 502))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should retry on 503 and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockResolvedValueOnce(textResponse("Service Unavailable", 503))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should retry on 504 and succeed", async () => {
      const client = createClient({ retries: 2 });
      mockFetch
        .mockResolvedValueOnce(textResponse("Gateway Timeout", 504))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("should NOT retry on 400 (client error)", async () => {
      const client = createClient({ retries: 2 });
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Bad request" }, 400));

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Bad request");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should NOT retry on 401 (unauthorized)", async () => {
      const client = createClient({ retries: 2 });
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Unauthorized");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should NOT retry on 404 (not found)", async () => {
      const client = createClient({ retries: 2 });
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Not found" }, 404));

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Not found");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should exhaust retries on persistent 500", async () => {
      const client = createClient({ retries: 2 });
      mockFetch.mockResolvedValue(jsonResponse({ error: "Internal Server Error" }, 500));

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("Internal Server Error");
      // 1 initial + 2 retries = 3 total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("should respect Retry-After header on 429", async () => {
      const backoffSpy = vi.fn().mockReturnValue(1);
      const client = createClient({ retries: 2, backoff: backoffSpy });

      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ error: "Rate limited" }, 429, { "retry-after": "1" })
        )
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      // Backoff function should NOT have been called for the HTTP retry
      // since Retry-After header was present and valid
      expect(backoffSpy).not.toHaveBeenCalled();
    });
  });

  describe("retry logic — mixed failures", () => {
    test("should handle network error then 502 then success", async () => {
      const client = createClient({ retries: 3 });
      mockFetch
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(htmlResponse("<html>502</html>", 502))
        .mockResolvedValueOnce(jsonResponse({ data: "ok" }));

      const result = await client.request({ method: "GET", path: ["v1", "test"] });
      expect(result.result).toEqual({ data: "ok" });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("retry disabled", () => {
    test("should not retry when retries=false", async () => {
      const client = new HttpClient({
        baseUrl: "https://api.example.com",
        retry: false,
        cache: "no-store",
      });
      mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

      await expect(
        client.request({ method: "GET", path: ["v1", "test"] })
      ).rejects.toThrow("fetch failed");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
