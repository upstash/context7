import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { editOpenCodeServer } from "../setup/opencode-editor.js";
import { readJsonConfig } from "../setup/mcp-writer.js";

let path: string;

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), "ctx7-opencode-")), "opencode.jsonc");
});

afterEach(async () => {
  await rm(join(path, ".."), { recursive: true, force: true });
});

const entry = { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true };

describe("editOpenCodeServer", () => {
  test("replaces the entry and keeps comments and trailing commas outside it", async () => {
    await writeFile(
      path,
      `// personal configuration
{
  "theme": "night", // dark
  "mcp": {
    // work server
    "other": { "type": "remote", "url": "https://other.example", },
    "context7": { "type": "local", "command": ["npx", "old"], },
  },
}
`
    );

    await editOpenCodeServer(path, entry);

    const updated = await readFile(path, "utf-8");
    expect(updated).toContain("// personal configuration");
    expect(updated).toContain("// dark");
    expect(updated).toContain("// work server");
    expect(updated).toContain('"other": { "type": "remote", "url": "https://other.example", },');
    expect(await readJsonConfig(path)).toEqual({
      theme: "night",
      mcp: { other: { type: "remote", url: "https://other.example" }, context7: entry },
    });
  });

  test("adds an indented entry to a file without an mcp section", async () => {
    await writeFile(path, '{\n  // keep\n  "theme": "night",\n}\n');

    await editOpenCodeServer(path, entry);

    const updated = await readFile(path, "utf-8");
    expect(updated).toContain("// keep");
    expect(updated).toContain('\n  "mcp": {\n    "context7": {\n      "type": "remote",\n');
    expect(await readJsonConfig(path)).toEqual({ theme: "night", mcp: { context7: entry } });
  });

  test.each([
    ["a missing file", undefined],
    ["an empty file", ""],
    ["a file with only a byte order mark", "\uFEFF\r\n"],
  ])("writes a new formatted config to %s", async (_name, source) => {
    if (source !== undefined) await writeFile(path, source);

    await editOpenCodeServer(path, entry);

    expect(await readFile(path, "utf-8")).toBe(
      JSON.stringify({ mcp: { context7: entry } }, null, 2) + "\n"
    );
  });

  test("edits a file that starts with a byte order mark", async () => {
    await writeFile(path, '\uFEFF{\n  "theme": "night",\n}\n');

    await editOpenCodeServer(path, entry);

    expect(await readJsonConfig(path)).toEqual({ theme: "night", mcp: { context7: entry } });
  });

  test("removes the only entry before a trailing comma and leaves valid JSONC", async () => {
    await writeFile(
      path,
      '{\n  // keep\n  "mcp": {\n    "context7": { "enabled": true },\n  },\n}\n'
    );

    await editOpenCodeServer(path);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({ mcp: {} });
  });
});
