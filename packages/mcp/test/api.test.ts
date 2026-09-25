import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchLibraryContext } from "../src/lib/api.js";

// fetchLibraryContext calls global fetch; stub it per case.
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Partial<Response> & { ok: boolean }) {
  // fetchLibraryContext reads response.headers (auth-prompt signal), so every
  // stub needs a real Headers object.
  const full = { headers: new Headers(), ...response } as Response;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => full)
  );
}

describe("fetchLibraryContext", () => {
  test("flags a non-ok API response as an error outcome", async () => {
    // A failed upstream response must carry a non-success outcome so the
    // query-docs tool can set isError:true instead of defaulting to success.
    stubFetch({
      ok: false,
      status: 404,
      json: async () => ({ message: "Library not found." }),
    });

    const result = await fetchLibraryContext({ query: "q", libraryId: "/no/such-lib" });
    expect(result.outcome).toBe("error");
    expect(result.data).toBe("Library not found.");
  });

  test("flags an empty response body as not found", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await fetchLibraryContext({ query: "q", libraryId: "/no/such-lib" });
    expect(result.outcome).toBe("not_found");
    expect(result.data).toContain("Documentation not found");
  });

  test("flags a network failure as an error outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const result = await fetchLibraryContext({ query: "q", libraryId: "/vercel/next.js" });
    expect(result.outcome).toBe("error");
    expect(result.data).toContain("Error fetching library context");
  });

  test("reports a successful documentation response", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: async () => "# Some real documentation",
    });

    const result = await fetchLibraryContext({ query: "q", libraryId: "/vercel/next.js" });
    expect(result.outcome).toBe("success");
    expect(result.data).toBe("# Some real documentation");
  });
});
