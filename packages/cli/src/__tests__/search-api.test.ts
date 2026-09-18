import { afterEach, describe, expect, test, vi } from "vitest";
import { getLibraryContext, searchDocumentation } from "../utils/api.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchDocumentation", () => {
  test("sends repeated library hints and ranking preferences", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(new Response("documentation text"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchDocumentation(
        "how do I stream a response?",
        {
          libraries: ["Next.js", "OpenAI"],
          version: "15.4.0",
          language: "TypeScript",
          type: "txt",
        },
        "access-token"
      )
    ).resolves.toBe("documentation text");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://context7.com/api/v2/search?query=how+do+I+stream+a+response%3F&library=Next.js&library=OpenAI&version=15.4.0&language=TypeScript&type=txt",
      {
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }
    );
  });

  test("returns structured snippets for JSON output", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");
    const response = {
      codeSnippets: [{ libraryId: "/facebook/react", codeTitle: "Hooks" }],
      infoSnippets: [],
      rules: {
        global: ["Use approved packages"],
        libraries: [{ libraryId: "/facebook/react", libraryOwn: ["Use hooks"], libraryTeam: [] }],
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));

    await expect(
      searchDocumentation("how do I use hooks?", { type: "json" }, "access-token")
    ).resolves.toEqual(response);
  });

  test("returns an error separately from successful snippets", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "no_documentation_found", message: "No matching documentation" },
            { status: 404 }
          )
        )
    );

    await expect(searchDocumentation("missing docs", { type: "json" })).resolves.toEqual({
      error: "no_documentation_found",
      message: "No matching documentation",
      redirectUrl: undefined,
    });
  });

  test("keeps the existing context redirect behavior", async () => {
    vi.stubEnv("CONTEXT7_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ redirectUrl: "/facebook/react" }, { status: 301 }))
    );

    await expect(getLibraryContext("/old/react", "hooks", { type: "json" })).resolves.toEqual({
      error: "library_redirected",
      message: undefined,
      redirectUrl: "/facebook/react",
    });
  });
});
