import { afterEach, describe, expect, test, vi } from "vitest";
import { searchDocumentation } from "../utils/api.js";

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
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));

    await expect(
      searchDocumentation("how do I use hooks?", { type: "json" }, "access-token")
    ).resolves.toEqual(response);
  });
});
