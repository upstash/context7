export type ContextRequest = {
  query: string;
  topic?: string;
  library?: string;
  mode?: "code" | "info";
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
};

export type ContextResponse = {
  data: string;
  usage: TokenUsage;
  usedLibraries?: string[];
};
