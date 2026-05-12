import { describe, test, expect, vi } from "vitest";
import { GetContextCommand } from "./index";
import { Context7Error } from "@error";
import type { Requester } from "@http";

function mockRequester(result: unknown): Requester {
  return {
    request: vi.fn().mockResolvedValue({ result }),
  };
}

describe("GetContextCommand — defensive parsing", () => {
  test("should handle response with missing codeSnippets field", async () => {
    const requester = mockRequester({
      infoSnippets: [
        { content: "Some docs", breadcrumb: "Guide", pageId: "p1" },
      ],
    });

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  test("should handle response with missing infoSnippets field", async () => {
    const requester = mockRequester({
      codeSnippets: [
        {
          codeTitle: "Example",
          codeDescription: "A hook example",
          codeLanguage: "tsx",
          codeList: [{ language: "tsx", code: "const x = 1;" }],
          codeId: "c1",
        },
      ],
    });

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  test("should handle response with both fields missing", async () => {
    const requester = mockRequester({});

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("should handle response with null fields", async () => {
    const requester = mockRequester({
      codeSnippets: null,
      infoSnippets: null,
    });

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  test("should handle undefined result", async () => {
    const requester = mockRequester(undefined);

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    await expect(command.exec(requester)).rejects.toThrow(Context7Error);
  });

  test("should return text for txt type", async () => {
    const requester: Requester = {
      request: vi.fn().mockResolvedValue({ result: "Plain text docs" }),
    };

    const command = new GetContextCommand("how to use hooks", "/facebook/react", {
      type: "txt",
    });
    const result = await command.exec(requester);

    expect(typeof result).toBe("string");
    expect(result).toBe("Plain text docs");
  });

  test("should format code and info snippets correctly", async () => {
    const requester = mockRequester({
      codeSnippets: [
        {
          codeTitle: "useState Example",
          codeDescription: "React hook for state",
          codeLanguage: "tsx",
          codeList: [{ language: "tsx", code: "const [count, setCount] = useState(0);" }],
          codeId: "c1",
        },
      ],
      infoSnippets: [
        {
          content: "useState is a React Hook...",
          breadcrumb: "Hooks > useState",
          pageId: "p1",
        },
      ],
    });

    const command = new GetContextCommand("how to use hooks", "/facebook/react");
    const result = await command.exec(requester);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);

    const [codeDoc, infoDoc] = result as { title: string; content: string; source: string }[];
    expect(codeDoc.title).toBe("useState Example");
    expect(codeDoc.content).toContain("const [count, setCount] = useState(0);");
    expect(codeDoc.source).toBe("c1");

    expect(infoDoc.title).toBe("Hooks > useState");
    expect(infoDoc.content).toBe("useState is a React Hook...");
    expect(infoDoc.source).toBe("p1");
  });
});
