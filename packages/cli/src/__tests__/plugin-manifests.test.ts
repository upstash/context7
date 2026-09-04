import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
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
});
