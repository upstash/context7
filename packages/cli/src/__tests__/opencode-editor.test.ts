import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { editOpenCodeServer, usesOpenCodeServersKey } from "../setup/opencode-editor.js";
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

  describe("OpenCode v2 (mcp.servers)", () => {
    const v2Entry = { type: "remote", url: "https://mcp.context7.com/mcp" };

    test("adds the entry under mcp.servers and drops the v1 enabled flag", async () => {
      await writeFile(
        path,
        `{
  // v2 config
  "mcp": {
    "servers": {
      "firecrawl": { "type": "remote", "url": "https://mcp.firecrawl.dev/v2/mcp-oauth" },
    },
  },
}
`
      );

      await editOpenCodeServer(path, entry);

      expect(await readFile(path, "utf-8")).toContain("// v2 config");
      expect(await readJsonConfig(path)).toEqual({
        mcp: {
          servers: {
            firecrawl: { type: "remote", url: "https://mcp.firecrawl.dev/v2/mcp-oauth" },
            context7: v2Entry,
          },
        },
      });
    });

    test("maps enabled: false to disabled: true", async () => {
      await writeFile(path, '{ "mcp": { "servers": {} } }\n');

      await editOpenCodeServer(path, { ...entry, enabled: false });

      expect(await readJsonConfig(path)).toEqual({
        mcp: { servers: { context7: { ...v2Entry, disabled: true } } },
      });
    });

    test("replaces an existing mcp.servers.context7 entry", async () => {
      await writeFile(
        path,
        JSON.stringify({
          mcp: {
            timeout: { startup: 45000 },
            servers: { context7: { type: "local", command: ["npx", "old"] } },
          },
        })
      );

      await editOpenCodeServer(path, entry);

      expect(await readJsonConfig(path)).toEqual({
        mcp: { timeout: { startup: 45000 }, servers: { context7: v2Entry } },
      });
    });

    test("removes only context7 from mcp.servers", async () => {
      await writeFile(
        path,
        JSON.stringify({
          mcp: {
            servers: { other: { type: "remote", url: "https://other.example" }, context7: v2Entry },
          },
        })
      );

      await editOpenCodeServer(path);

      expect(await readJsonConfig(path)).toEqual({
        mcp: { servers: { other: { type: "remote", url: "https://other.example" } } },
      });
    });

    test("empties mcp.servers when context7 is the only server", async () => {
      await writeFile(
        path,
        '{\n  "mcp": {\n    "servers": {\n      "context7": {},\n    },\n  },\n}\n'
      );

      await editOpenCodeServer(path);

      expect(await readJsonConfig(path)).toEqual({ mcp: { servers: {} } });
    });
  });

  test.each([
    [{}, false],
    [{ mcp: {} }, false],
    [{ mcp: { context7: entry } }, false],
    [{ mcp: { servers: { type: "remote", url: "https://servers.example" } } }, false],
    [{ mcp: { servers: {} } }, true],
    [{ mcp: { servers: { context7: entry } } }, true],
  ])("usesOpenCodeServersKey(%j) is %s", (config, expected) => {
    expect(usesOpenCodeServersKey(config)).toBe(expected);
  });
});
