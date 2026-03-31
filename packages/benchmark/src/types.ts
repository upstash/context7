export type DetectionMethod = "mcp" | "skill" | "cli";

export interface ModeConfig {
  mcp: boolean;
  rule: boolean;
  skill: boolean;
  claudeMd: boolean;
  ruleContent: string | null;
  claudeMdContent: string | null;
  detection: DetectionMethod;
  description: string;
  useLocalMcp?: boolean;
  skillSnapshot?: "original";
  skillContent?: string;
}

export interface EvalItem {
  query: string;
  should_trigger: boolean;
  category: string;
}

export interface QueryResult {
  triggered: boolean;
  firstTool: string | null;
  elapsed: number;
  error: string | null;
}

export interface EvalResult {
  query: string;
  shouldTrigger: boolean;
  triggered: boolean;
  pass: boolean;
  firstTool: string | null;
  elapsed: number;
  error: string | null;
}

export interface ModeSummary {
  mode: string;
  model: string;
  maxTurns: number;
  elapsedSeconds: number;
  authMode: string;
  total: number;
  passed: number;
  recall: string;
  precision: string;
  falsePositives: number;
  results: EvalResult[];
}

export interface BenchOptions {
  modes: string[];
  model: string;
  workers: number;
  maxTurns: number;
  timeout: number;
  authMode: "default" | "api-key";
  withContext: boolean;
  compare: boolean;
}
