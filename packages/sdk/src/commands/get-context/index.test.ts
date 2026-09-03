import { describe, test, expect } from "vitest";
import { GetContextCommand } from "./index";
import type { Requester } from "@http";

function requesterWith(result: unknown): Requester {
  return {
    request: async <TResult>() => ({ result: result as TResult }),
  };
}

describe("GetContextCommand", () => {
  test("maps code and information snippets to documentation", async () => {
    const command = new GetContextCommand("How to use hooks", "/react/react");
    const result = await command.exec(
      requesterWith({
        codeSnippets: [
          {
            codeTitle: "State hook",
            codeDescription: "Store component state.",
            codeLanguage: "tsx",
            codeList: [{ language: "tsx", code: "const [value] = useState(0);" }],
            codeId: "hooks/use-state",
          },
        ],
        infoSnippets: [
          {
            breadcrumb: "Hooks > State",
            content: "State is local to a component instance.",
            pageId: "hooks/state",
          },
        ],
      })
    );

    expect(result).toEqual([
      {
        title: "State hook",
        content: "Store component state.\n\n```tsx\nconst [value] = useState(0);\n```",
        source: "hooks/use-state",
      },
      {
        title: "Hooks > State",
        content: "State is local to a component instance.",
        source: "hooks/state",
      },
    ]);
  });

  test("returns text responses unchanged", async () => {
    const command = new GetContextCommand("How to use hooks", "/react/react", {
      type: "txt",
    });

    await expect(command.exec(requesterWith("documentation text"))).resolves.toBe(
      "documentation text"
    );
  });
});
