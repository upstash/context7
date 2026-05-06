import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpClient } from "./index";
import { Context7Error } from "@error";

describe("HttpClient error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("throws Context7Error for non-JSON error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Bad gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html" },
      })
    );

    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      retry: false,
    });

    try {
      await client.request({ path: ["v2", "libs", "search"] });
      throw new Error("Expected request to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Context7Error);
      expect((error as Error).message).toBe("Bad Gateway");
    }
  });

  test("prefers API error message when response body is JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "rate limit exceeded" }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "application/json" },
      })
    );

    const client = new HttpClient({
      baseUrl: "https://example.com/api",
      retry: false,
    });

    await expect(client.request({ path: ["v2", "libs", "search"] })).rejects.toMatchObject({
      message: "rate limit exceeded",
    });
  });
});
