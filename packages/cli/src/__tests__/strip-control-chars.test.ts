import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLibraryCode,
  getLibraryContext,
  getUpgradeGuide,
  resolveLibrary,
  searchDocumentation,
  stripControlChars,
} from "../utils/api.js";

const EVIL = "\x1b]52;c;ZWNobyBwd25k\x07\x1b[2J\x1b[Htitle\r\n\tok\x9b1m";
const CLEAN = "title\n\tok";

function stubFetch(body: string, init: ResponseInit = {}): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, init)));
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

describe("stripControlChars", () => {
  it("removes escape sequences from nested API content, keeps newlines and tabs", () => {
    expect(stripControlChars(EVIL)).toBe(CLEAN);
    expect(stripControlChars({ a: [EVIL, 1, null], b: { c: EVIL } })).toEqual({
      a: [CLEAN, 1, null],
      b: { c: CLEAN },
    });
  });

  it("removes whole OSC and CSI sequences, not just their introducers", () => {
    expect(stripControlChars("\x1b]8;;https://evil.example\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
    expect(stripControlChars("\x1b[31mred\x1b[0m \x9b2Jdone")).toBe("red done");
  });

  it("strips object keys, which JSON.stringify would print with C1 intact", () => {
    const stripped = stripControlChars({ "k\x9b2J": { "\x1b[2Jinner\x85": EVIL } });
    expect(stripped).toEqual({ k: { inner: CLEAN } });
    expect(JSON.stringify(stripped)).not.toMatch(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/);
  });

  it("keeps printable Unicode", () => {
    expect(stripControlChars("café 日本語 emoji 🎉")).toBe("café 日本語 emoji 🎉");
  });
});

describe("API responses are stripped", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolveLibrary", async () => {
    stubFetch(json({ results: [{ id: "/a/b", title: EVIL, description: EVIL }] }));
    const result = await resolveLibrary("b");
    expect(result.results[0].title).toBe(CLEAN);
    expect(result.results[0].description).toBe(CLEAN);
  });

  it("getLibraryContext as text and JSON", async () => {
    stubFetch(EVIL);
    expect(await getLibraryContext("/a/b", "q", { type: "txt" })).toBe(CLEAN);

    stubFetch(
      json({
        codeSnippets: [{ codeTitle: EVIL, codeList: [{ language: "ts", code: EVIL }] }],
        infoSnippets: [{ content: EVIL }],
      })
    );
    expect(await getLibraryContext("/a/b", "q", { type: "json" })).toEqual({
      codeSnippets: [{ codeTitle: CLEAN, codeList: [{ language: "ts", code: CLEAN }] }],
      infoSnippets: [{ content: CLEAN }],
    });
  });

  it("getLibraryContext error message", async () => {
    stubFetch(json({ error: "not_found", message: EVIL }), { status: 404 });
    const result = await getLibraryContext("/a/b", "q");
    expect(typeof result !== "string" && result.message).toBe(CLEAN);
  });

  it("getLibraryCode result and pending message", async () => {
    stubFetch(EVIL);
    expect(await getLibraryCode("/a/b", "x")).toEqual({ kind: "result", body: CLEAN });

    stubFetch(json({ message: EVIL, retryAfter: 5 }), { status: 202 });
    expect(await getLibraryCode("/a/b", "x")).toEqual({
      kind: "pending",
      message: CLEAN,
      retryAfter: 5,
    });
  });

  it("getUpgradeGuide result and error", async () => {
    stubFetch(EVIL);
    expect(await getUpgradeGuide("/a/b", "1.0.0")).toEqual({ kind: "result", body: CLEAN });

    stubFetch(json({ error: "bad", message: EVIL }), { status: 400 });
    expect(await getUpgradeGuide("/a/b", "1.0.0")).toEqual({
      kind: "error",
      error: "bad",
      message: CLEAN,
    });
  });

  it("searchDocumentation as text and JSON, and its error", async () => {
    stubFetch(EVIL);
    expect(await searchDocumentation("q", { type: "txt" })).toBe(CLEAN);

    stubFetch(json({ results: [{ title: EVIL, ["key\x9b2J"]: 1 }] }));
    expect(await searchDocumentation("q", { type: "json" })).toEqual({
      results: [{ title: CLEAN, key: 1 }],
    });

    stubFetch(json({ message: EVIL }), { status: 500 });
    await expect(searchDocumentation("q", { type: "txt" })).rejects.toThrow(CLEAN);
  });
});
