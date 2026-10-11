import { randomUUID } from "node:crypto";
import { createMCPClient } from "@ai-sdk/mcp";

// Each connection represents one conversation, shared by search and fetch.
export async function connectParallelTools(modelName, fetchImpl = globalThis.fetch) {
  const sessionId = randomUUID();
  const client = await createMCPClient({
    clientName: "context7-parallel-search-example",
    transport: {
      type: "http",
      url: "https://search.parallel.ai/mcp",
      headers: { "User-Agent": "context7-parallel-search-example/1.0.0" },
      fetch: (url, init) =>
        fetchImpl(url, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
            : AbortSignal.timeout(30_000),
        }),
    },
    initializationOptions: { timeout: 30_000 },
  });

  try {
    const discovered = await client.tools();
    const tools = {};
    for (const name of ["web_search", "web_fetch"]) {
      const tool = discovered[name];
      if (!tool?.execute) throw new Error(`Parallel MCP did not expose ${name}`);
      tools[name] = {
        ...tool,
        execute: (args, options) =>
          tool.execute({ ...args, session_id: sessionId, model_name: modelName }, options),
      };
    }
    return { tools, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
