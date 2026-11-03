import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { removeOpenCodeServer, writeOpenCodeServer } from "../setup/opencode-editor.js";
import { readJsonConfig } from "../setup/mcp-writer.js";

let path: string;

beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), "ctx7-opencode-")), "opencode.jsonc");
});

afterEach(async () => {
  await rm(join(path, ".."), { recursive: true, force: true });
});

const entry = { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true };
const v2Entry = { type: "remote", url: "https://mcp.context7.com/mcp" };
const firecrawl = { type: "remote", url: "https://mcp.firecrawl.dev/v2/mcp-oauth" };

/** Writes `entry` (a 1.x entry) the way setup does. */
function write(newEntry: Record<string, unknown> = entry): Promise<boolean> {
  return writeOpenCodeServer(path, () => newEntry);
}

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

    expect(await write()).toBe(true);

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

    expect(await write()).toBe(false);

    const updated = await readFile(path, "utf-8");
    expect(updated).toContain("// keep");
    expect(updated).toContain('\n  "mcp": {\n    "context7": {\n      "type": "remote",\n');
    expect(await readJsonConfig(path)).toEqual({ theme: "night", mcp: { context7: entry } });
  });

  test.each([
    ["a missing file", undefined],
    ["an empty file", ""],
    ["a file with only a byte order mark", "﻿\r\n"],
  ])("writes a new formatted config to %s", async (_name, source) => {
    if (source !== undefined) await writeFile(path, source);

    await write();

    expect(await readFile(path, "utf-8")).toBe(
      JSON.stringify({ mcp: { context7: entry } }, null, 2) + "\n"
    );
  });

  test("edits a file that starts with a byte order mark", async () => {
    await writeFile(path, '﻿{\n  "theme": "night",\n}\n');

    await write();

    expect(await readJsonConfig(path)).toEqual({ theme: "night", mcp: { context7: entry } });
  });

  test.each([
    ["only global mcp options", { mcp: { timeout: { startup: 1000 } } }],
    ["1.x servers", { mcp: { firecrawl } }],
    ["a 1.x server named servers", { mcp: { servers: firecrawl } }],
  ])("keeps the 1.x layout for %s", async (_name, config) => {
    await writeFile(path, JSON.stringify(config));

    await write();

    expect(await readJsonConfig(path)).toEqual({
      ...config,
      mcp: { ...config.mcp, context7: entry },
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

    expect(await write()).toBe(false);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
  });

  test("uses an empty mcp.servers map", async () => {
    await writeFile(path, JSON.stringify({ mcp: { servers: {} } }));

    await write();

    expect(await readJsonConfig(path)).toEqual({ mcp: { servers: { context7: v2Entry } } });
  });

  test("moves a stale mcp.context7 entry into mcp.servers", async () => {
    await writeFile(
      path,
      JSON.stringify({ mcp: { servers: { firecrawl }, context7: entry } }, null, 2)
    );

    expect(await write()).toBe(true);

    expect(await readJsonConfig(path)).toEqual({
      mcp: { servers: { firecrawl, context7: v2Entry } },
    });
  });

  test("maps enabled: false to disabled: true", async () => {
    await writeFile(path, JSON.stringify({ mcp: { servers: {} } }));

    await write({ ...entry, enabled: false });

    expect(await readJsonConfig(path)).toEqual({
      mcp: { servers: { context7: { ...v2Entry, disabled: true } } },
    });
  });
});

describe("writeOpenCodeServer existing entry", () => {
  test.each([
    ["missing", {}, undefined],
    ["in the 1.x layout", { mcp: { context7: entry } }, entry],
    ["in the 2.x layout", { mcp: { servers: { context7: v2Entry } } }, v2Entry],
    [
      "in both layouts, 2.x first",
      { mcp: { servers: { context7: v2Entry }, context7: entry } },
      v2Entry,
    ],
  ])("passes the entry to buildEntry when %s", async (_name, config, expected) => {
    await writeFile(path, JSON.stringify(config));
    const buildEntry = vi.fn(() => entry);

    await writeOpenCodeServer(path, buildEntry);

    expect(buildEntry).toHaveBeenCalledWith(expected);
  });
});

describe("invalid JSON", () => {
  const source = '{ "mcp": { "servers": {';

  test("writeOpenCodeServer throws and leaves the file unchanged", async () => {
    await writeFile(path, source);

    await expect(write()).rejects.toThrow(/Invalid JSON config/);

    expect(await readFile(path, "utf-8")).toBe(source);
  });

  test("removeOpenCodeServer throws and leaves the file unchanged", async () => {
    await writeFile(path, source);

    await expect(removeOpenCodeServer(path)).rejects.toThrow(/Invalid JSON config/);

    expect(await readFile(path, "utf-8")).toBe(source);
  });
});

describe("removeOpenCodeServer", () => {
  test("removes the only 1.x entry before a trailing comma and leaves valid JSONC", async () => {
    await writeFile(
      path,
      '{\n  // keep\n  "mcp": {\n    "context7": { "enabled": true },\n  },\n}\n'
    );

    expect(await removeOpenCodeServer(path)).toBe(true);

    expect(await readFile(path, "utf-8")).toContain("// keep");
    expect(await readJsonConfig(path)).toEqual({ mcp: {} });
  });

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

  test.each([
    ["a missing file", undefined],
    ["a file without an entry", '{\n  // keep\n  "mcp": { "servers": { "firecrawl": {} } },\n}\n'],
  ])("leaves %s unchanged", async (_name, source) => {
    if (source !== undefined) await writeFile(path, source);

    expect(await removeOpenCodeServer(path)).toBe(false);

    if (source === undefined) await expect(readFile(path, "utf-8")).rejects.toThrow(/ENOENT/);
    else expect(await readFile(path, "utf-8")).toBe(source);
  });
});
