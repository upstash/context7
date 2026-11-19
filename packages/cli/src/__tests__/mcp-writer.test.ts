import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parse, type ParseError } from "jsonc-parser";

import { patchJsonConfig } from "../setup/mcp-writer.js";

let tempDir: string;
let configPath: string;

const JSONC_CONFIG = `{
  // shared MCP servers for this repo
  "servers": {
    // our own docs server
    "internal-docs": { "type": "http", "url": "https://docs.example.com/mcp" },
  },
}
`;

const CONTEXT7_ENTRY = {
  type: "http",
  url: "https://mcp.context7.com/mcp",
  headers: { Authorization: "Bearer ctx7sk-test" },
};

beforeEach(async () => {
  tempDir = join(tmpdir(), `ctx7-mcp-writer-${Date.now()}`);
  configPath = join(tempDir, "mcp.json");
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function parseConfig(raw: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true }) as Record<string, unknown>;
  expect(errors).toEqual([]);
  return parsed;
}

function expectCommentsPreserved(before: string, after: string): void {
  const commentLines = before
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("//"));
  expect(commentLines.length).toBeGreaterThan(0);
  for (const comment of commentLines) {
    expect(after).toContain(comment);
  }
}

describe("patchJsonConfig", () => {
  test("adds an entry without dropping comments or the trailing comma", async () => {
    await writeFile(configPath, JSONC_CONFIG, "utf-8");

    expect(await patchJsonConfig(configPath, ["servers", "context7"], CONTEXT7_ENTRY)).toBe(true);

    const after = await readFile(configPath, "utf-8");
    expectCommentsPreserved(JSONC_CONFIG, after);
    // The file stays JSONC: the trailing comma after the section is still there.
    expect(after).toMatch(/},\s*\n\}/);

    const config = parseConfig(after);
    expect(config.servers).toMatchObject({
      "internal-docs": { type: "http", url: "https://docs.example.com/mcp" },
      context7: CONTEXT7_ENTRY,
    });
  });

  test("removes one entry and keeps the comments around it", async () => {
    await writeFile(configPath, JSONC_CONFIG, "utf-8");
    await patchJsonConfig(configPath, ["servers", "context7"], CONTEXT7_ENTRY);

    expect(await patchJsonConfig(configPath, ["servers", "context7"], undefined)).toBe(true);

    const after = await readFile(configPath, "utf-8");
    expectCommentsPreserved(JSONC_CONFIG, after);
    expect(after).not.toContain("context7");

    const config = parseConfig(after);
    expect(config.servers).toMatchObject({
      "internal-docs": { type: "http", url: "https://docs.example.com/mcp" },
    });
  });

  test("drops the section when its last entry is removed", async () => {
    await writeFile(
      configPath,
      `{
  // only Context7 is configured here
  "servers": {
    "context7": { "type": "http", "url": "https://mcp.context7.com/mcp" }
  }
}
`,
      "utf-8"
    );

    expect(await patchJsonConfig(configPath, ["servers"], undefined)).toBe(true);

    const after = await readFile(configPath, "utf-8");
    expect(parseConfig(after)).not.toHaveProperty("servers");
    expect(after).not.toContain("context7");
  });

  test("leaves a trailing-comma edit to the caller instead of writing broken JSONC", async () => {
    await writeFile(configPath, JSONC_CONFIG, "utf-8");

    // Removing the section of this fixture would strand its trailing comma.
    expect(await patchJsonConfig(configPath, ["servers"], undefined)).toBe(false);
    expect(await readFile(configPath, "utf-8")).toBe(JSONC_CONFIG);
  });

  test("keeps the file's own line endings", async () => {
    const crlf = JSONC_CONFIG.replace(/\n/g, "\r\n");
    await writeFile(configPath, crlf, "utf-8");

    expect(await patchJsonConfig(configPath, ["servers", "context7"], CONTEXT7_ENTRY)).toBe(true);

    const after = await readFile(configPath, "utf-8");
    expect(after.split("\n").length - 1).toBe(after.split("\r\n").length - 1);
  });

  test("declines files it cannot edit in place so the caller can rewrite them", async () => {
    expect(await patchJsonConfig(join(tempDir, "missing.json"), ["servers"], {})).toBe(false);

    await writeFile(configPath, "", "utf-8");
    expect(await patchJsonConfig(configPath, ["servers"], {})).toBe(false);

    await writeFile(configPath, "{ not json", "utf-8");
    expect(await patchJsonConfig(configPath, ["servers"], {})).toBe(false);
    expect(await readFile(configPath, "utf-8")).toBe("{ not json");
  });
});
