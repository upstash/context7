import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

describe("plugin MCP manifests", () => {
  // Deliberately the raw key, not `Bearer <key>` as the CLI writes. Both plugins
  // document that an unset key still works over the anonymous tier, and this is
  // the only form that survives both states: the server rejects `Bearer` with an
  // empty token but treats an empty Authorization as anonymous.
  test.each(["plugins/claude/context7/.mcp.json", "plugins/copilot/context7/.mcp.json"])(
    "%s passes the raw key via Authorization",
    async (relPath) => {
      const raw = await readFile(join(REPO_ROOT, relPath), "utf-8");
      const config = JSON.parse(raw) as {
        mcpServers: { context7: { headers: Record<string, string> } };
      };
      expect(config.mcpServers.context7.headers).toEqual({
        Authorization: "${CONTEXT7_API_KEY:-}",
      });
    }
  );
});
