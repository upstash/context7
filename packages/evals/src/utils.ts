import type { ActualInvocation, EvalCase, IntegrationDef, PromptConfig } from "./types.js";

export function checkExpectation(
  invocations: ActualInvocation[],
  expect: EvalCase["expect"]
): boolean {
  const used = new Set(invocations.map((i) => i.integration));
  if (expect.invokes?.some((name) => !used.has(name))) return false;
  if (expect.skips?.some((name) => used.has(name))) return false;
  return true;
}

export function mapToInvocations(
  calls: Array<{ toolName: string; toolInput: unknown }>,
  integrations: IntegrationDef[]
): ActualInvocation[] {
  return calls.flatMap((call) => {
    const integration = integrations.find((i) => {
      const watched = i.watchTools.some(
        (w) =>
          call.toolName === w || // exact
          call.toolName === `mcp__${i.name}__${w}` || // Claude Agent SDK: mcp__serverName__toolName
          call.toolName.endsWith(`_${w}`) // OpenCode: serverName_toolName
      );
      if (!watched) return false;
      if (i.matchInvocation) return i.matchInvocation(call.toolName, call.toolInput);
      return true;
    });
    if (!integration) return [];
    return [{ integration: integration.name, tool: call.toolName, args: call.toolInput }];
  });
}

/**
 * Builds EvalCase[] from a prompt corpus and a set of integrations.
 *
 * - Single integration: doc prompts assert `invokes`, non-doc prompts assert `skips`.
 * - Multiple integrations + `preferredIntegration`: doc prompts assert the preferred one is invoked.
 * - Multiple integrations, no preference: doc prompts have no invocation assertion (observe-only).
 *   Non-doc prompts always assert all integrations are skipped.
 */
export function buildCases(
  integrations: IntegrationDef[],
  prompts: PromptConfig[],
  preferredIntegration?: string
): EvalCase[] {
  const allNames = integrations.map((i) => i.name);

  return prompts.map((p) => {
    const label = `[${allNames.join("+")}] ${p.prompt}`;

    if (!p.expectInvoke) {
      return { name: label, prompt: p.prompt, integrations, expect: { skips: allNames } };
    }

    if (integrations.length === 1) {
      return {
        name: label,
        prompt: p.prompt,
        integrations,
        expect: { invokes: [allNames[0]] },
      };
    }

    if (preferredIntegration) {
      return {
        name: label,
        prompt: p.prompt,
        integrations,
        expect: { invokes: [preferredIntegration] },
      };
    }

    return { name: label, prompt: p.prompt, integrations, expect: {} };
  });
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
