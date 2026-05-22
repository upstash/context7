import { describe, it, expect } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/context7";

function collectTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    registerTool(def: ToolDefinition) {
      tools.set(def.name, def);
    },
  } as unknown as ExtensionAPI;
  extension(pi);
  return tools;
}

describe("extension registration", () => {
  const tools = collectTools();

  it("registers resolve-library-id and query-docs", () => {
    expect([...tools.keys()].sort()).toEqual(["query-docs", "resolve-library-id"]);
  });

  function paramKeys(def: ToolDefinition): string[] {
    const schema = def.parameters as { properties: Record<string, unknown> };
    return Object.keys(schema.properties).sort();
  }

  it("resolve-library-id has query + libraryName params", () => {
    const def = tools.get("resolve-library-id")!;
    expect(paramKeys(def)).toEqual(["libraryName", "query"]);
    expect(def.description).toContain("Context7");
  });

  it("query-docs has libraryId + query params", () => {
    const def = tools.get("query-docs")!;
    expect(paramKeys(def)).toEqual(["libraryId", "query"]);
    expect(def.description).toContain("Context7");
  });
});

describe("live Context7 API", () => {
  const tools = collectTools();

  it("resolve-library-id returns text for a real library", async () => {
    const def = tools.get("resolve-library-id")!;
    const result = await def.execute(
      "test-call",
      { query: "how do hooks work?", libraryName: "React" },
      undefined,
      undefined,
      {} as never
    );
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { text: string }).text).toMatch(/react/i);
  });
});
