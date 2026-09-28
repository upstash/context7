import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

describe("plugin MCP manifests", () => {
  test("Claude sends no Authorization header so OAuth can run", async () => {
    const relPath = "plugins/claude/context7/.mcp.json";
    const raw = await readFile(join(REPO_ROOT, relPath), "utf-8");
    const config = JSON.parse(raw) as {
      mcpServers: { context7: Record<string, unknown> };
    };
    expect(config.mcpServers.context7).toEqual({
      type: "http",
      url: "https://mcp.context7.com/mcp?client=claude-code-plugin",
    });
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
