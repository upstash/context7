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
    const fetchMock = vi.fn(
      async () =>
        new Response("## Documentation", {
          headers: {
            "X-Context7-Library-Ids": "/vercel/next.js,/colinhacks/zod",
            "X-Context7-Search-Status": "complete",
            "X-Context7-Retryable": "false",
            "X-Context7-Retry-Reason": "none",
            "X-Context7-Suggested-Action": "none",
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
      "/v2/context/search?query=Next.js+with+Zod&type=txt"
    );
  });

  it("forwards optional routing hints without adding a second request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("## Documentation", {
          headers: {
            "X-Context7-Library-Ids": "/vercel/next.js/v15",
            "X-Context7-Search-Status": "complete",
            "X-Context7-Retryable": "false",
          },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAutoLibraryContext(
      "How does caching work?",
      {},
      { library: "nextjs", version: "15" }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("library")).toBe("nextjs");
    expect(url.searchParams.get("version")).toBe("15");
    expect(url.searchParams.has("libraryId")).toBe(false);
  });

  it("preserves terminal miss metadata so agents do not retry the same call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { message: "No documentation matched the request." },
          {
            status: 404,
            headers: {
              "X-Context7-Search-Status": "not-found",
              "X-Context7-Retryable": "false",
              "X-Context7-Retry-Reason": "no-relevant-documentation",
              "X-Context7-Suggested-Action": "refine-query",
            },
          }
        )
      )
    );

    await expect(fetchAutoLibraryContext("unknown symbol")).resolves.toMatchObject({
      error: "No documentation matched the request.",
      status: "not-found",
      retryable: false,
      retryReason: "no-relevant-documentation",
      suggestedAction: "refineQuery",
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
