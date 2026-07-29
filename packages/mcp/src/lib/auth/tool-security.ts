import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { securitySchemesFor } from "./lazy-auth.js";

interface ToolListEntry {
  name: string;
  [key: string]: unknown;
}

type ListToolsHandler = (...args: unknown[]) => Promise<{ tools?: ToolListEntry[] }>;

/**
 * Add a `securitySchemes` array to every tool in `tools/list`, declaring which
 * tools run anonymously and which need OAuth. OpenAI clients read this to know
 * a tool is callable before the user has linked an account; clients that don't
 * know the field ignore it.
 *
 * The SDK's `registerTool` only forwards the config fields it knows about, so
 * this wraps the `tools/list` handler the SDK installed rather than passing the
 * array through registration. If a future SDK stops registering the handler
 * under that key, the wrap is skipped: tools still list correctly, only the
 * extra field goes missing. `test/tool-security.test.ts` asserts the field on
 * the wire of a real server so that regression fails the build instead of
 * silently reaching clients.
 *
 * Call after every tool is registered — the SDK installs the handler lazily on
 * first `registerTool`.
 */
export function advertiseToolSecuritySchemes(server: McpServer): void {
  const handlers = (
    server.server as unknown as { _requestHandlers?: Map<string, ListToolsHandler> }
  )._requestHandlers;
  const listTools = handlers?.get("tools/list");
  if (!handlers || !listTools) return;

  handlers.set("tools/list", async (...args: unknown[]) => {
    const result = await listTools(...args);
    if (!Array.isArray(result?.tools)) return result;
    return {
      ...result,
      tools: result.tools.map((tool) => ({
        ...tool,
        securitySchemes: securitySchemesFor(tool.name),
      })),
    };
  });
}
