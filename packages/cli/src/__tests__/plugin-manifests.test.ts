import { describe, test, expect } from "vitest";
import { access, readdir, readFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const execFileAsync = promisify(execFile);

describe("plugin MCP manifests", () => {
  test("Claude uses an API key only when one is set", async () => {
    const relPath = "plugins/claude/context7/.mcp.json";
    const raw = await readFile(join(REPO_ROOT, relPath), "utf-8");
    const config = JSON.parse(raw) as {
      mcpServers: { context7: { headers?: Record<string, string>; headersHelper: string } };
    };
    expect(config.mcpServers.context7.headers).toBeUndefined();
    expect(config.mcpServers.context7.headersHelper).toBe(
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/headers.mjs"'
    );

    const helper = join(REPO_ROOT, "plugins/claude/context7/scripts/headers.mjs");
    const withoutKey = await execFileAsync(process.execPath, [helper], {
      env: { ...process.env, CONTEXT7_API_KEY: "" },
    });
    expect(JSON.parse(withoutKey.stdout)).toEqual({});

    const withKey = await execFileAsync(process.execPath, [helper], {
      env: { ...process.env, CONTEXT7_API_KEY: "ctx7sk-test" },
    });
    expect(JSON.parse(withKey.stdout)).toEqual({ Authorization: "ctx7sk-test" });
  });

  test("Copilot passes the raw API key via Authorization", async () => {
    const raw = await readFile(join(REPO_ROOT, "plugins/copilot/context7/.mcp.json"), "utf-8");
    const config = JSON.parse(raw) as {
      mcpServers: { context7: { headers: Record<string, string> } };
    };
    expect(config.mcpServers.context7.headers).toEqual({
      Authorization: "${CONTEXT7_API_KEY:-}",
    });
  });

  test("Cursor plugin names a skill it actually ships", async () => {
    const relPath = "plugins/cursor/context7/rules/use-context7.mdc";
    const rule = await readFile(join(REPO_ROOT, relPath), "utf-8");
    const readme = await readFile(join(REPO_ROOT, "plugins/cursor/context7/README.md"), "utf-8");
    const shipped = (await readdir(join(REPO_ROOT, "plugins/cursor/context7/skills"))).sort();

    // Both files point the reader at a skill by name; a rename that misses one
    // of them leaves a dangling reference the agent cannot resolve.
    for (const [file, content] of [
      [relPath, rule],
      ["plugins/cursor/context7/README.md", readme],
    ] as const) {
      const reference = content.match(/`(context7-[a-z0-9-]+)` skill/)?.[1];
      expect(reference, `${file} should reference a skill by name`).toBeDefined();
      expect(shipped, `${file} references "${reference}"`).toContain(reference);
    }
  });

  test("Cursor plugin's skill directories all contain a SKILL.md", async () => {
    const dir = join(REPO_ROOT, "plugins/cursor/context7/skills");
    for (const entry of await readdir(dir)) {
      await expect(access(join(dir, entry, "SKILL.md"))).resolves.toBeUndefined();
    }
  });
});
