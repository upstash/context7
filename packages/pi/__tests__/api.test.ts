import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchLibraries, fetchLibraryContext } from "../lib/api";

describe("fetchLibraryContext", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed error string when API returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ message: "Something went wrong" }),
      text: vi.fn(),
    });

    const result = await fetchLibraryContext("express", "express-lib");
    expect(typeof result).toBe("string");
    expect(result).toBe("Something went wrong");
  });

  it("returns library context on successful response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("# Express Docs\n..."),
    });

    const result = await fetchLibraryContext("express", "express-lib");
    expect(typeof result).toBe("string");
    expect(result).toBe("# Express Docs\n...");
  });

  it("returns error message when response body is empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(""),
    });

    const result = await fetchLibraryContext("express", "express-lib");
    expect(typeof result).toBe("string");
    expect(result).toContain("Documentation not found");
  });
});

describe("searchLibraries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed error string when API returns non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ message: "Search failed" }),
      text: vi.fn(),
    });

    const result = await searchLibraries("express", "express");
    expect(result.error).toBe("Search failed");
  });

  it("returns search results on successful response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          { id: "express-lib", title: "Express", description: "Web framework" },
        ],
      }),
      text: vi.fn(),
    });

    const result = await searchLibraries("express", "express");
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0].title).toBe("Express");
  });
});

describe("network error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetchLibraryContext returns error string on network failure instead of throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network connection failed"));

    const result = await fetchLibraryContext("express", "express-lib");
    expect(typeof result).toBe("string");
    expect(result).toContain("Error");
  });

  it("searchLibraries returns error result on network failure instead of throwing", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network connection failed"));

    const result = await searchLibraries("express", "express");
    expect(result.error).toBeDefined();
    expect(result.results).toEqual([]);
  });
});
