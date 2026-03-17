import type { EvalConfig, EvalResult } from "./types.js";
import { runEvalsWithAISdk } from "./runners/aisdk.js";
import { runEvalsWithClaudeAgent } from "./runners/claude-agent.js";
import { runEvalsWithOpenCode } from "./runners/opencode.js";

export async function runEvals(config: EvalConfig): Promise<EvalResult[]> {
  const agent = config.agent ?? "aisdk";
  if (agent === "claude") return runEvalsWithClaudeAgent(config);
  if (agent === "opencode") return runEvalsWithOpenCode(config);
  return runEvalsWithAISdk(config);
}
