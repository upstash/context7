import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readOpenCodeConfig, updateOpenCodeServer } from "../setup/opencode-editor.js";
import { patchStdioApiKey, readJsonConfig } from "../setup/mcp-writer.js";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "ctx7-jsonc-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

const remoteEntry = { type: "remote", url: "https://mcp.context7.com/mcp", enabled: true };

describe("OpenCode configuration editing", () => {
  test.each(["opencode.json", "opencode.jsonc"])(
    "accepts comments and trailing commas in %s and preserves unrelated text",
    async (filename) => {
      const path = join(temporaryDirectory, filename);
      const source = `// personal configuration
{
  /* keep this comment */
  "instructions": ["https://example.com//docs", "/* literal */",],
  "mcp": {
    "other": {"type": "remote", "url": "https://other.example",},
  },
}
`;
      await writeFile(path, source);
      const result = await updateOpenCodeServer(path, () => remoteEntry);
      expect(result.alreadyExists).toBe(false);
      const updated = await readFile(path, "utf-8");
      expect(updated).toContain(source.slice(0, source.indexOf('  "mcp"')));
      expect(updated).toContain('"other": {"type": "remote", "url": "https://other.example",},');
      expect(updated).toMatch(/},\n}\n$/);
      expect((await readOpenCodeConfig(path)).mcp).toEqual({
        other: { type: "remote", url: "https://other.example" },
        context7: remoteEntry,
      });
      await updateOpenCodeServer(path, () => remoteEntry);
      expect(await readFile(path, "utf-8")).toBe(updated);
    }
  );

  test("updates only changed values, retaining nested comments, commas, and CRLF tabs", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    const source = `{
\t"mcp": {
\t\t"context7": {
\t\t\t"type": "remote",
\t\t\t// endpoint
\t\t\t"url": "https://old.example",
\t\t\t"enabled": true,
\t\t},
\t},
}
`.replaceAll("\n", "\r\n");
    await writeFile(path, source);
    expect((await updateOpenCodeServer(path, () => remoteEntry)).alreadyExists).toBe(true);
    expect(await readFile(path, "utf-8")).toBe(
      source.replace("https://old.example", remoteEntry.url)
    );
  });

  test("keeps pinned stdio commands and comments when rotating an API key", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    const source = `{
  "mcp": {
    "context7": {
      "type": "local",
      "command": ["npx", "-y", /* pinned */ "@upstash/context7-mcp@3.2.5", "--api-key", "old-key",],
      "enabled": true,
    },
  },
}
`;
    await writeFile(path, source);
    await updateOpenCodeServer(path, (existing) => patchStdioApiKey(existing!, "new-key"));
    expect(await readFile(path, "utf-8")).toBe(source.replace("old-key", "new-key"));
  });

  test("removes Context7 without rewriting other servers and is idempotent", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    const source = `{
  // unrelated setting
  "instructions": ["a",],
  "mcp": {
    "context7": {"type": "remote", "url": "https://old.example",},
    // another server
    "other": {"url": "https://other.example",},
  },
}
`;
    await writeFile(path, source);
    expect((await updateOpenCodeServer(path, () => undefined)).removed).toBe(true);
    const updated = await readFile(path, "utf-8");
    expect(updated).toContain('// unrelated setting\n  "instructions": ["a",],');
    expect(updated).toContain('// another server\n    "other": {"url": "https://other.example",},');
    expect((await readOpenCodeConfig(path)).mcp).toEqual({
      other: { url: "https://other.example" },
    });
    expect((await updateOpenCodeServer(path, () => undefined)).removed).toBe(false);
    expect(await readFile(path, "utf-8")).toBe(updated);
  });

  test("retains comments in an empty MCP section", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(path, '{"mcp": {"context7": {}, /* keep section notes */},}\n');
    await updateOpenCodeServer(path, () => undefined);
    expect(await readFile(path, "utf-8")).toContain("/* keep section notes */");
    expect(await readOpenCodeConfig(path)).toEqual({ mcp: {} });
  });

  test.each([
    '{"other": {}, "context7": {}}',
    '{"other": {}, "context7": {},}',
    '{"context7": {}, "other": {}}',
    '{"before": {}, "context7": {}, "after": {}}',
    '{"context7": {}}',
    '{"context7": {},}',
  ])("removes entries at any position: %s", async (servers) => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(path, `{"mcp": ${servers}}`);
    await updateOpenCodeServer(path, () => undefined);
    expect((await readOpenCodeConfig(path)).mcp).not.toHaveProperty("context7");
  });

  test("adds and removes stdio credentials while preserving command comments", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(
      path,
      '{"mcp": {"context7": {"command": ["npx", /* pinned */ "@upstash/context7-mcp@3.2.5",],},},}'
    );
    await updateOpenCodeServer(path, (existing) => patchStdioApiKey(existing!, "new-key"));
    expect(await readFile(path, "utf-8")).toContain('/* pinned */ "@upstash/context7-mcp@3.2.5"');
    await updateOpenCodeServer(path, (existing) => patchStdioApiKey(existing!, undefined));
    expect(await readFile(path, "utf-8")).toContain('/* pinned */ "@upstash/context7-mcp@3.2.5"');
    expect((await readOpenCodeConfig(path)).mcp).toEqual({
      context7: { command: ["npx", "@upstash/context7-mcp@3.2.5"] },
    });
  });

  test("switches transports without leaving stale properties", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(
      path,
      '{"mcp": {"context7": {"type": "local", "command": ["npx", "@upstash/context7-mcp",], "enabled": true,},},}'
    );
    await updateOpenCodeServer(path, () => remoteEntry);
    expect((await readOpenCodeConfig(path)).mcp).toEqual({ context7: remoteEntry });
  });

  test("creates missing parent directories and does not create files during removal", async () => {
    const path = join(temporaryDirectory, "nested", "opencode.json");
    expect(await readOpenCodeConfig(path)).toEqual({});
    expect((await updateOpenCodeServer(path, () => undefined)).removed).toBe(false);
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    await updateOpenCodeServer(path, () => remoteEntry);
    expect(await readOpenCodeConfig(path)).toEqual({ mcp: { context7: remoteEntry } });
  });

  test.each([
    '{"mcp": {,,}}',
    '{"mcp": {"context7": {"url": "unterminated}}}',
    "{/* unterminated",
    '{"mcp": []}',
    '{"mcp": null}',
    "[]",
    "null",
    "",
  ])("rejects invalid input without changing the file: %s", async (source) => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(path, source);
    await expect(readOpenCodeConfig(path)).rejects.toThrow(path);
    await expect(updateOpenCodeServer(path, () => remoteEntry)).rejects.toThrow(path);
    await expect(updateOpenCodeServer(path, () => undefined)).rejects.toThrow(path);
    expect(await readFile(path, "utf-8")).toBe(source);
  });

  test("does not treat other read failures as missing configuration", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await mkdir(path);
    await expect(updateOpenCodeServer(path, () => remoteEntry)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  test("does not overwrite a concurrent edit", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    await writeFile(path, "{}");
    const manualEdit = '{"instructions": ["new.md",],}';
    await expect(
      updateOpenCodeServer(path, () => {
        writeFileSync(path, manualEdit);
        return remoteEntry;
      })
    ).rejects.toThrow("Configuration changed while editing");
    expect(await readFile(path, "utf-8")).toBe(manualEdit);
  });

  test("refuses ambiguous deletion when duplicate Context7 keys remain", async () => {
    const path = join(temporaryDirectory, "opencode.jsonc");
    const source = '{"mcp": {"context7": {}, "context7": {"enabled": true}}}';
    await writeFile(path, source);
    await expect(updateOpenCodeServer(path, () => undefined)).rejects.toThrow("duplicate keys");
    expect(await readFile(path, "utf-8")).toBe(source);
  });

  test("leaves the shared reader's trailing-comma behavior unchanged", async () => {
    const path = join(temporaryDirectory, "mcp.json");
    await writeFile(path, '{"mcpServers": {},}');
    await expect(readJsonConfig(path)).rejects.toThrow();
  });
});
