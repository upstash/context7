import { createOpencode } from "@opencode-ai/sdk";
import type { ToolPart } from "@opencode-ai/sdk";
import { createServer } from "net";
import type {
  EvalResult,
  EvalCase,
  IntegrationDef,
  McpServerConfig,
  EvalConfig,
} from "../types.js";
import { buildCases, checkExpectation, mapToInvocations } from "../utils.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

export async function runEvalsWithOpenCode(config: EvalConfig): Promise<EvalResult[]> {
  const { integrations, prompts, runs = 1, preferredIntegration } = config;
  const cases = buildCases(integrations, prompts, preferredIntegration);
  const results: EvalResult[] = [];

  const mcpConfig = buildMcpConfig(integrations);

  const port = await getFreePort();
  const { client, server } = await createOpencode({
    port,
    config: {
      ...(Object.keys(mcpConfig).length > 0 ? { mcp: mcpConfig } : {}),
    },
  });

  try {
    for (const c of cases) {
      for (let i = 0; i < runs; i++) {
        const start = Date.now();
        try {
          const invocations = await runSingleCase(client, c);
          results.push({
            case: c,
            actualInvocations: invocations,
            pass: checkExpectation(invocations, c.expect),
            durationMs: Date.now() - start,
          });
        } catch (e) {
          results.push({
            case: c,
            actualInvocations: [],
            pass: false,
            durationMs: Date.now() - start,
            error: String(e),
          });
        }
      }
    }
  } finally {
    server.close();
  }

  return results;
}

async function runSingleCase(
  client: Awaited<ReturnType<typeof createOpencode>>["client"],
  c: EvalCase
) {
  const session = await client.session.create();
  const sessionId = session.data?.id;
  if (!sessionId) throw new Error("Failed to create OpenCode session");

  const systemAppend = buildSystemAppend(c.integrations);
  const toolCalls: Array<{ toolName: string; toolInput: unknown }> = [];

  const events = await client.event.subscribe();
  const eventCollector = (async () => {
    for await (const event of events.stream) {
      if (event.type === "message.part.updated") {
        const part = event.properties.part;
        if (part.type === "tool") {
          const toolPart = part as ToolPart;
          toolCalls.push({ toolName: toolPart.tool, toolInput: toolPart.metadata ?? {} });
        }
      }
      if (event.type === "session.idle") break;
      if (event.type === "session.status") {
        const status = event.properties.status as { type: string };
        if (status.type === "idle") break;
      }
    }
  })();

  client.session.prompt({
    path: { id: sessionId },
    body: {
      ...(systemAppend ? { system: systemAppend } : {}),
      parts: [{ type: "text" as const, text: c.prompt }],
    },
  });

  await eventCollector;

  return mapToInvocations(toolCalls, c.integrations);
}

function buildMcpConfig(
  integrations: IntegrationDef[]
): Record<string, { type: "local"; command: string[] }> {
  const config: Record<string, { type: "local"; command: string[] }> = {};
  for (const i of integrations) {
    if (i.type === "mcp" && i.mcpServer) {
      config[i.name] = toMcpLocalConfig(i.mcpServer);
    }
  }
  return config;
}

function toMcpLocalConfig(s: McpServerConfig): { type: "local"; command: string[] } {
  return { type: "local", command: [s.command, ...(s.args ?? [])] };
}

function buildSystemAppend(integrations: IntegrationDef[]): string {
  return integrations
    .filter((i) => i.type === "skill" && i.systemPrompt)
    .map((i) => i.systemPrompt!)
    .join("\n\n");
}
