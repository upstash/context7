import { describe, expect, test } from "vitest";
import { SearchCommand } from "./index";
import { requesterWith } from "@utils/test-utils";

describe("SearchCommand", () => {
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
});
