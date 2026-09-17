import { describe, expect, test } from "vitest";
import { SearchCommand } from "./index";
import { requesterWith } from "@utils/test-utils";

describe("SearchCommand", () => {
  test("builds a request with repeated library hints and preferences", () => {
    const command = new SearchCommand("How do I store vectors?", {
      libraries: ["Upstash Vector", "/upstash/vector-js"],
      version: "v1.2.0",
      language: "TypeScript",
      type: "json",
    });

    expect(command.request).toEqual({
      method: "GET",
      query: {
        query: "How do I store vectors?",
        type: "json",
        library: ["Upstash Vector", "/upstash/vector-js"],
        version: "v1.2.0",
        language: "TypeScript",
      },
    });
  });

  test("preserves JSON snippets and rules without a lossy conversion", async () => {
    const command = new SearchCommand("How do I use hooks?", { type: "json" });
    const response = {
      codeSnippets: [
        {
          libraryId: "/facebook/react",
          codeTitle: "State hook",
          codeDescription: "Store component state.",
          codeLanguage: "tsx",
          codeList: [{ language: "tsx", code: "const [value] = useState(0);" }],
          codeId: "hooks/use-state",
        },
      ],
      infoSnippets: [
        {
          libraryId: "/facebook/react",
          breadcrumb: "Hooks > State",
          content: "State is local to a component instance.",
          pageId: "hooks/state",
        },
      ],
      rules: {
        global: ["Use approved packages"],
        libraries: [{ libraryId: "/facebook/react", libraryOwn: ["Use hooks"], libraryTeam: [] }],
      },
    };

    await expect(command.exec(requesterWith(response))).resolves.toEqual(response);
  });

  test("returns text responses unchanged", async () => {
    const command = new SearchCommand("How do I use hooks?", { type: "txt" });

    await expect(command.exec(requesterWith("documentation text"))).resolves.toBe(
      "documentation text"
    );
  });

  test("defaults to a structured JSON response", () => {
    expect(new SearchCommand("How do I use hooks?").request.query).toMatchObject({
      type: "json",
    });
  });
});
