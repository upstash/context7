import { describe, expect, test } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { advertiseToolSecuritySchemes } from "../src/lib/auth/tool-security.js";

/**
 * These assert what actually goes out on the wire, not what our helper returns.
 * `securitySchemes` is not part of the SDK's `Tool` schema, so a client built on
 * the SDK would parse it away — the only faithful check is the raw JSON-RPC
 * message the server sends. This is also the regression guard for the fact that
 * the helper wraps an SDK-internal handler: if a future SDK stops registering
 * `tools/list` under that key, these fail instead of the field quietly
 * disappearing from production responses.
 */

interface CapturedMessage {
  id?: unknown;
  result?: { tools?: Array<Record<string, unknown>> };
}

function captureTransport(sent: CapturedMessage[]): Transport {
  return {
    start: async () => {},
    send: async (message: unknown) => {
      sent.push(message as CapturedMessage);
    },
    close: async () => {},
  } as Transport;
}

async function listToolsOverWire(server: McpServer): Promise<Array<Record<string, unknown>>> {
  const sent: CapturedMessage[] = [];
  const transport = captureTransport(sent);
  await server.connect(transport);

  transport.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as never);
  // Handlers resolve on the microtask queue; one macrotask is enough to drain.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const response = sent.find((m) => m.id === 1);
  expect(response, "server never answered tools/list").toBeDefined();
  return response!.result?.tools ?? [];
}

function serverWithTools(): McpServer {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool(
    "resolve-library-id",
    { description: "public", inputSchema: { libraryName: z.string() } },
    async () => ({ content: [{ type: "text", text: "ok" }] })
  );
  server.registerTool(
    "query-docs",
    { description: "public", inputSchema: { libraryId: z.string() } },
    async () => ({ content: [{ type: "text", text: "ok" }] })
  );
  return server;
}

describe("advertiseToolSecuritySchemes", () => {
  test("every listed tool carries securitySchemes on the wire", async () => {
    const server = serverWithTools();
    advertiseToolSecuritySchemes(server);

    const tools = await listToolsOverWire(server);
    expect(tools.map((t) => t.name).sort()).toEqual(["query-docs", "resolve-library-id"]);
    for (const tool of tools) {
      expect(tool.securitySchemes, `missing on ${tool.name}`).toEqual([
        { type: "noauth" },
        { type: "oauth2", scopes: ["profile", "email"] },
      ]);
    }
  });

  test("the tool definition is otherwise untouched", async () => {
    const server = serverWithTools();
    const before = await listToolsOverWire(serverWithTools());
    advertiseToolSecuritySchemes(server);
    const after = await listToolsOverWire(server);

    for (const [i, tool] of after.entries()) {
      const { securitySchemes, ...rest } = tool;
      expect(securitySchemes).toBeDefined();
      expect(rest).toEqual(before[i]);
    }
  });

  test("is a no-op on a server with no tools/list handler", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => advertiseToolSecuritySchemes(server)).not.toThrow();
  });
});
