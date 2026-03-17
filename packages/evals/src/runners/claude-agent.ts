import { query } from "@anthropic-ai/claude-agent-sdk";

// Each concurrent claude-code subprocess adds an exit listener to the Node process.
// Raise the limit to avoid MaxListenersExceededWarning when running many in parallel.
process.setMaxListeners(100);
import type {
  EvalResult,
  EvalCase,
  IntegrationDef,
  McpServerConfig,
  EvalConfig,
} from "../types.js";
import { buildCases, checkExpectation, mapToInvocations, runWithConcurrency } from "../utils.js";

export async function runEvalsWithClaudeAgent(config: EvalConfig): Promise<EvalResult[]> {
  const {
    integrations,
    prompts,
    runs = 1,
    maxSteps = 5,
    preferredIntegration,
    cwd,
    concurrency = 24,
  } = config;
  const cases = buildCases(integrations, prompts, preferredIntegration);

  const tasks: Array<() => Promise<EvalResult>> = cases.flatMap((c) =>
    Array.from({ length: runs }, () => async () => {
      const start = Date.now();
      try {
        const invocations = await runSingleCase(c, { maxSteps, cwd });
        return {
          case: c,
          actualInvocations: invocations,
          pass: checkExpectation(invocations, c.expect),
          durationMs: Date.now() - start,
        };
      } catch (e) {
        return {
          case: c,
          actualInvocations: [],
          pass: false,
          durationMs: Date.now() - start,
          error: String(e),
        };
      }
    })
  );

  return runWithConcurrency(tasks, concurrency);
}

async function runSingleCase(c: EvalCase, options: { maxSteps: number; cwd?: string }) {
  const mcpServers = buildMcpServers(c.integrations);
  const hasSkill = c.integrations.some((i) => i.type === "skill");

  const toolCalls: Array<{ toolName: string; toolInput: unknown }> = [];
  const debugMode = process.env.EVAL_DEBUG === "1";

  for await (const message of query({
    prompt: c.prompt,
    options: {
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      cwd: options.cwd ?? process.cwd(),
      ...(hasSkill ? { settingSources: ["project"] } : {}),
      allowedTools: hasSkill ? ["Skill"] : [],
      maxTurns: options.maxSteps,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (typeof block === "object" && block !== null && "type" in block) {
          const b = block as { type: string; name?: string; input?: unknown };
          if (b.type === "tool_use" && b.name) {
            if (debugMode) console.log(`[claude-agent] tool_use: ${b.name}`);
            toolCalls.push({ toolName: b.name, toolInput: b.input ?? {} });
          }
        }
      }
    }
  }

  return mapToInvocations(toolCalls, c.integrations);
}

function buildMcpServers(integrations: IntegrationDef[]): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const i of integrations) {
    if (i.type === "mcp" && i.mcpServer) {
      servers[i.name] = i.mcpServer;
    }
  }
  return servers;
}
