import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const MANIFESTS_WITH_KEY = [
  "plugins/claude/context7/.mcp.json",
  "plugins/copilot/context7/.mcp.json",
];

async function readHeaders(relPath: string): Promise<Record<string, string>> {
  const raw = await readFile(join(REPO_ROOT, relPath), "utf-8");
  const config = JSON.parse(raw) as {
    mcpServers: { context7: { headers?: Record<string, string> } };
  };
  return config.mcpServers.context7.headers ?? {};
}

describe("plugin MCP manifests", () => {
  // These deliberately differ from the CLI, which writes `Bearer <key>`. Both
  // plugins document that an unset key still works over the anonymous tier, and
  // the raw form is the only one that survives both states: the server rejects
  // `Bearer` with an empty token but treats an empty Authorization as anonymous.
  // Drop the `${...:-}` default or add a `Bearer ` prefix and anonymous use breaks.
  test.each(MANIFESTS_WITH_KEY)("%s passes the raw key, not a Bearer prefix", async (relPath) => {
    const headers = await readHeaders(relPath);
    expect(headers.Authorization).toBe("${CONTEXT7_API_KEY:-}");
  });

  test.each(MANIFESTS_WITH_KEY)("%s uses the standard header name", async (relPath) => {
    const headers = await readHeaders(relPath);
    expect(Object.keys(headers)).toEqual(["Authorization"]);
  });
});
