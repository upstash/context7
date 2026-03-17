import { tool } from "ai";
import { z } from "zod";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";
import {
  resolveLibraryIdSchema,
  resolveLibraryIdDescription,
  queryDocsSchema,
  queryDocsDescription,
} from "@upstash/context7-mcp/lib/tools";
import type { IntegrationDef } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = resolve(__dirname, "../../../mcp/dist/index.js");

/**
 * Creates an IntegrationDef for the Context7 MCP integration.
 *
 * Tools use real descriptions and schemas from the MCP package so models see
 * accurate tool definitions, but execute functions return stubs so no real API
 * calls are made and no subprocesses are spawned during routing evals.
 *
 * The cc runner uses mcpServer to connect to the real server natively.
 */
export function createMCPIntegration(config?: {
  name?: string;
  watchTools?: string[];
  systemPrompt?: string;
}): IntegrationDef {
  const name = config?.name ?? "context7-mcp";
  const tools = {
    "resolve-library-id": tool({
      description: resolveLibraryIdDescription,
      inputSchema: z.object(resolveLibraryIdSchema),
      execute: async ({ libraryName }: { libraryName: string }) =>
        `[stub] Resolved "${libraryName}" to /stub/${libraryName.toLowerCase()}`,
    }),
    "query-docs": tool({
      description: queryDocsDescription,
      inputSchema: z.object(queryDocsSchema),
      execute: async ({ libraryId }: { libraryId: string }) =>
        `[stub] Documentation for "${libraryId}": no real content in eval mode.`,
    }),
  };
  const watchTools = config?.watchTools ?? Object.keys(tools);

  return {
    name,
    type: "mcp",
    tools,
    watchTools,
    mcpServer: { command: "node", args: [MCP_SERVER_PATH] },
    ...(config?.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
  };
}
