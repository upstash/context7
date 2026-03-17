import type { LanguageModel, ToolSet } from "ai";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface IntegrationDef {
  name: string;
  type: "skill" | "mcp";
  watchTools: string[];
  matchInvocation?: (toolName: string, args: unknown) => boolean;
  systemPrompt?: string;
  tools?: ToolSet;
  mcpServer?: McpServerConfig;
  shortCode?: string;
}

export interface ActualInvocation {
  integration: string;
  tool: string;
  args: unknown;
}

export interface Expectation {
  invokes?: string[];
  skips?: string[];
}

export interface EvalCase {
  name?: string;
  prompt: string;
  integrations: IntegrationDef[];
  expect: Expectation;
}

export interface EvalResult {
  case: EvalCase;
  actualInvocations: ActualInvocation[];
  pass: boolean;
  durationMs: number;
  error?: string;
}

export interface RunOptions {
  runs?: number;
  maxSteps?: number;
}

export interface PromptConfig {
  prompt: string;
  expectInvoke: boolean;
}

export interface EvalConfig {
  /**
   * Which agent runtime to use.
   * - "aisdk"     – Vercel AI SDK (default); requires `model`
   * - "claude"    – Claude Agent SDK (claude-code)
   * - "opencode"  – OpenCode SDK
   */
  agent?: "aisdk" | "claude" | "opencode";
  /** Required when agent is "aisdk" (the default). */
  model?: LanguageModel;
  integrations: IntegrationDef[];
  prompts: PromptConfig[];
  runs?: number;
  maxSteps?: number;
  /**
   * When multiple integrations are present, assert this one is invoked for docs prompts.
   * If omitted with multiple integrations, doc prompts are treated as observe-only (no assertion).
   */
  preferredIntegration?: string;
  /** Working directory passed to the agent process (claude / opencode only). */
  cwd?: string;
  /** Max number of prompts to run in parallel. Defaults to 10. */
  concurrency?: number;
}
