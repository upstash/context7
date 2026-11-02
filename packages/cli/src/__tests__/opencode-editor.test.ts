import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectOpenCodeLayout,
  removeOpenCodeServer,
  resolveOpenCodeLayout,
  toOpenCodeEntry,
  writeOpenCodeServer,
} from "../setup/opencode-editor.js";
import { readJsonConfig } from "../setup/mcp-writer.js";

let path: string;

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), "ctx7-opencode-")), "opencode.jsonc");
});

afterEach(async () => {
  await rm(join(path, ".."), { recursive: true, force: true });
});

const entry = { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true };

describe("writeOpenCodeServer (1.x layout)", () => {
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

    await writeOpenCodeServer(path, entry, "v1");

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

    await writeOpenCodeServer(path, entry, "v1");

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

    await writeOpenCodeServer(path, entry, "v1");

    expect(await readFile(path, "utf-8")).toBe(
      JSON.stringify({ mcp: { context7: entry } }, null, 2) + "\n"
    );
  });

  test("edits a file that starts with a byte order mark", async () => {
    await writeFile(path, '\uFEFF{\n  "theme": "night",\n}\n');

    await writeOpenCodeServer(path, entry, "v1");

    expect(await readJsonConfig(path)).toEqual({ theme: "night", mcp: { context7: entry } });
  });

  test("removes the only entry before a trailing comma and leaves valid JSONC", async () => {
    await writeFile(
      path,
      '{\n  // keep\n  "mcp": {\n    "context7": { "enabled": true },\n  },\n}\n'
    );

    await removeOpenCodeServer(path);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({ mcp: {} });
  });
});

const v2Entry = { type: "remote", url: "https://mcp.context7.com/mcp" };
const firecrawl = { type: "remote", url: "https://mcp.firecrawl.dev/v2/mcp-oauth" };

describe("detectOpenCodeLayout", () => {
  test.each([
    ["no mcp section", {}, undefined],
    ["an empty mcp section", { mcp: {} }, undefined],
    ["only global mcp options", { mcp: { timeout: { startup: 1000 } } }, undefined],
    ["a 2.x servers map", { mcp: { servers: { firecrawl } } }, "v2"],
    ["an empty 2.x servers map", { mcp: { servers: {} } }, "v2"],
    ["a 2.x map next to a stale 1.x entry", { mcp: { servers: {}, context7: entry } }, "v2"],
    ["1.x servers", { mcp: { firecrawl } }, "v1"],
    ["a 1.x server named servers", { mcp: { servers: firecrawl } }, "v1"],
  ])("reads %s", (_name, config, expected) => {
    expect(detectOpenCodeLayout(config as Record<string, unknown>)).toBe(expected);
  });
});

describe("resolveOpenCodeLayout", () => {
  test("prefers the config shape over the installed version", async () => {
    const getMajor = vi.fn(async () => 2);
    expect(await resolveOpenCodeLayout({ mcp: { firecrawl } }, getMajor)).toBe("v1");
    expect(getMajor).not.toHaveBeenCalled();
  });

  test.each([
    [2, "v2"],
    [3, "v2"],
    [1, "v1"],
    [undefined, "v1"],
  ])("uses installed major %s for a config without servers", async (major, expected) => {
    expect(await resolveOpenCodeLayout({}, async () => major)).toBe(expected);
  });
});

describe("toOpenCodeEntry", () => {
  test("keeps 1.x entries unchanged", () => {
    expect(toOpenCodeEntry(entry, "v1")).toEqual(entry);
  });

  test("drops enabled for 2.x and maps enabled: false to disabled", () => {
    expect(toOpenCodeEntry(entry, "v2")).toEqual(v2Entry);
    expect(toOpenCodeEntry({ ...entry, enabled: false }, "v2")).toEqual({
      ...v2Entry,
      disabled: true,
    });
  });
});

describe("writeOpenCodeServer (2.x layout)", () => {
  test("nests the entry inside mcp.servers next to other servers", async () => {
    await writeFile(
      path,
      `{
  // keep
  "mcp": {
    "servers": {
      "firecrawl": { "type": "remote", "url": "https://mcp.firecrawl.dev/v2/mcp-oauth" },
    },
  },
}
`
    );

    expect(await writeOpenCodeServer(path, v2Entry, "v2")).toBe(false);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
  });

  test("moves a stale mcp.context7 entry into mcp.servers", async () => {
    await writeFile(
      path,
      JSON.stringify({ mcp: { servers: { firecrawl }, context7: entry } }, null, 2)
    );

    expect(await writeOpenCodeServer(path, v2Entry, "v2")).toBe(true);

    expect(await readJsonConfig(path)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
  });

  test("writes a new 2.x config to a missing file", async () => {
    await writeOpenCodeServer(path, v2Entry, "v2");

    expect(await readJsonConfig(path)).toEqual({ mcp: { servers: { context7: v2Entry } } });
  });
});

describe("removeOpenCodeServer", () => {
  test("removes the 2.x entry and keeps other servers", async () => {
    await writeFile(
      path,
      '{\n  // keep\n  "mcp": {\n    "servers": {\n      "firecrawl": { "type": "remote", "url": "https://mcp.firecrawl.dev/v2/mcp-oauth" },\n      "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },\n    },\n  },\n}\n'
    );

    expect(await removeOpenCodeServer(path)).toBe(true);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({ mcp: { servers: { firecrawl } } });
  });

  test("removes entries from both layouts", async () => {
    await writeFile(
      path,
      JSON.stringify({ mcp: { servers: { context7: v2Entry }, context7: entry } }, null, 2)
    );

    expect(await removeOpenCodeServer(path)).toBe(true);

    expect(await readJsonConfig(path)).toEqual({ mcp: { servers: {} } });
  });

  test("leaves the file unchanged when there is no entry", async () => {
    const source = '{\n  // keep\n  "mcp": { "servers": { "firecrawl": {} } },\n}\n';
    await writeFile(path, source);

    expect(await removeOpenCodeServer(path)).toBe(false);

    expect(await readFile(path, "utf-8")).toBe(source);
  });
});
