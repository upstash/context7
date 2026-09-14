import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAutoLibraryContext,
  MAX_AUTO_CONTEXT_CHARACTERS,
  truncateDocumentationContext,
} from "../src/lib/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("automatic context response controls", () => {
  it("keeps short context intact and truncates oversized context within budget", () => {
    expect(truncateDocumentationContext("short", 100)).toBe("short");
    const output = truncateDocumentationContext(`${"a".repeat(90)}\n${"b".repeat(90)}`, 120);
    expect(output.length).toBeLessThanOrEqual(120);
    expect(output).toContain("Context truncated");
    expect(
      truncateDocumentationContext(
        "x".repeat(MAX_AUTO_CONTEXT_CHARACTERS + 1_000),
        MAX_AUTO_CONTEXT_CHARACTERS
      ).length
    ).toBeLessThanOrEqual(MAX_AUTO_CONTEXT_CHARACTERS);
  });

  it("truncates at a complete snippet and closes an open code fence", () => {
    const firstSnippet = `### First\n\n\`\`\`ts\n${"a".repeat(40)}\n\`\`\``;
    const secondSnippet = `### Second\n\n\`\`\`ts\n${"b".repeat(200)}\n\`\`\``;
    const output = truncateDocumentationContext(
      `${firstSnippet}\n\n--------------------------------\n\n${secondSnippet}`,
      170
    );
    expect(output).toContain("### First");
    expect(output).not.toContain("### Second");
    expect((output.match(/```/g)?.length ?? 0) % 2).toBe(0);
  });

  it("uses one Search API request and reads selected-library metadata", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        text: "## Documentation",
        routes: [],
        results: [{ libraryId: "/vercel/next.js" }, { libraryId: "/colinhacks/zod" }],
        meta: {
          status: "complete",
          retryable: false,
          reason: "none",
          suggestedAction: "none",
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAutoLibraryContext("Next.js with Zod")).resolves.toEqual({
      data: "## Documentation",
      libraryIds: ["/vercel/next.js", "/colinhacks/zod"],
      status: "complete",
      retryable: false,
      retryReason: "none",
      suggestedAction: "none",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v2/context/search?query=Next.js+with+Zod&type=json"
    );
  });

  it("forwards optional routing hints without adding a second request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        text: "## Documentation",
        routes: [],
        results: [{ libraryId: "/vercel/next.js/v15" }],
        meta: { status: "complete", retryable: false },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAutoLibraryContext(
      "How does caching work?",
      {},
      { libraries: ["nextjs"], version: "15" }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("library")).toBe("nextjs");
    expect(url.searchParams.get("version")).toBe("15");
    expect(url.searchParams.has("libraryId")).toBe(false);
  });

  it("forwards multiple library hints in one Search API request", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ text: "## Documentation", results: [], routes: [], meta: {} })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAutoLibraryContext(
      "Compare esbuild and Bun bundling commands",
      {},
      {
        libraries: ["esbuild", "Bun"],
      }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.getAll("library")).toEqual(["esbuild", "Bun"]);
  });

  it("preserves terminal miss metadata so agents do not retry the same call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            message: "No documentation matched the request.",
            meta: {
              status: "notFound",
              retryable: false,
              reason: "noMatchingLibrary",
              suggestedAction: "checkLibraryOrVersion",
            },
          },
          { status: 404 }
        )
      )
    );

    await expect(fetchAutoLibraryContext("unknown symbol")).resolves.toMatchObject({
      error: "No documentation matched the request.",
      status: "notFound",
      retryable: false,
      retryReason: "noMatchingLibrary",
      suggestedAction: "checkLibraryOrVersion",
    });
  });

  it("keeps gateway rate limits retryable when metadata headers are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 429 }))
    );

    await expect(fetchAutoLibraryContext("Next.js caching")).resolves.toMatchObject({
      retryable: true,
    });
  });
});
