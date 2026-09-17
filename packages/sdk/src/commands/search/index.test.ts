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

  test("maps JSON snippets and preserves their library IDs", async () => {
    const command = new SearchCommand("How do I use hooks?", { type: "json" });
    const result = await command.exec(
      requesterWith({
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
      })
    );

    expect(result).toEqual([
      {
        libraryId: "/facebook/react",
        title: "State hook",
        content: "Store component state.\n\n```tsx\nconst [value] = useState(0);\n```",
        source: "hooks/use-state",
      },
      {
        libraryId: "/facebook/react",
        title: "Hooks > State",
        content: "State is local to a component instance.",
        source: "hooks/state",
      },
    ]);
  });

  test("returns text responses unchanged", async () => {
    const command = new SearchCommand("How do I use hooks?");

    await expect(command.exec(requesterWith("documentation text"))).resolves.toBe(
      "documentation text"
    );
  });
});
