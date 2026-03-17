import { generateText, stepCountIs, type ToolSet } from "ai";
import type { EvalConfig, EvalResult, IntegrationDef } from "../types.js";
import { buildCases, checkExpectation, mapToInvocations, runWithConcurrency } from "../utils.js";

export async function runEvalsWithAISdk(config: EvalConfig): Promise<EvalResult[]> {
  if (!config.model) throw new Error('model is required when agent is "aisdk"');
  const model = config.model;
  const {
    integrations,
    prompts,
    runs = 1,
    maxSteps = 5,
    preferredIntegration,
    concurrency = 24,
  } = config;
  const cases = buildCases(integrations, prompts, preferredIntegration);

  const tasks: Array<() => Promise<EvalResult>> = cases.flatMap((c) =>
    Array.from({ length: runs }, () => async () => {
      const start = Date.now();
      try {
        const { system, tools } = buildAgentContext(c.integrations);
        const result = await generateText({
          model,
          prompt: c.prompt,
          ...(system ? { system } : {}),
          ...(Object.keys(tools).length > 0 ? { tools } : {}),
          stopWhen: stepCountIs(maxSteps),
        });
        const allToolCalls = result.steps.flatMap((s) =>
          s.toolCalls.map((call) => ({ toolName: call.toolName, toolInput: call.input }))
        );
        const invocations = mapToInvocations(allToolCalls, c.integrations);
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

function buildAgentContext(integrations: IntegrationDef[]): { system: string; tools: ToolSet } {
  const systemParts = integrations.map((i) => i.systemPrompt).filter((s): s is string => !!s);
  const tools: ToolSet = Object.assign({}, ...integrations.map((i) => i.tools ?? {}));
  return { system: systemParts.join("\n\n"), tools };
}
