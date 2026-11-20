import type { ExperimentalTool, ToolCallOutcome } from "./tool-names.js";

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: DocumentState;
  totalTokens: number;
  totalSnippets: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  source?: string;
}

export interface SearchResponse {
  error?: string;
  results: SearchResult[];
  searchFilterApplied?: boolean;
}

// Version state is still needed for validating search results
export type DocumentState = "initial" | "finalized" | "error" | "delete";

export type ContextRequest = {
  query: string;
  libraryId: string;
  language?: string;
  version?: string;
};

export type ContextResponse = {
  data: string;
  outcome: ToolCallOutcome;
};

export const CODE_OPERATIONS = [
  "grep",
  "definition",
  "references",
  "outline",
  "read",
  "list",
] as const;
export type CodeOperation = (typeof CODE_OPERATIONS)[number];
export const CODE_OUTPUT_MODES = ["content", "files_with_matches", "count"] as const;

/** A GET /v2/code request, as the code tools (code-tools.ts) send it. Search fields follow ripgrep. */
export type CodeRequest = {
  libraryId: string;
  /** A git tag, or a commit from a result header. A version suffix on libraryId also works. */
  version?: string;
  operation?: CodeOperation;
  pattern?: string;
  fixed_strings?: boolean;
  ignore_case?: boolean;
  glob?: string | string[];
  path?: string;
  context?: number;
  before_context?: number;
  after_context?: number;
  word_regexp?: boolean;
  multiline?: boolean;
  multiline_dotall?: boolean;
  output_mode?: (typeof CODE_OUTPUT_MODES)[number];
  head_limit?: number;
  offset?: number;
};

export interface ClientContext {
  clientIp?: string;
  apiKey?: string;
  clientInfo?: {
    ide?: string;
    version?: string;
  };
  plugin?: string;
  mcpEndpoint?: "/mcp" | "/mcp/oauth";
  mcpAuthMode?: "observe" | "required";
  transport?: "stdio" | "http";
  sessionId?: string;
  /**
   * The experimental tools this server lists; a non-empty list is sent as
   * `X-Context7-Experimental: 1` so the app counts experimental use. With the code tools on,
   * `X-Context7-Code-Tools: 1` too.
   */
  experimentalTools?: readonly ExperimentalTool[];
  /** Mutable: set by the upstream API layer when the backend signals the
   *  client should be prompted to sign in. Read by the auth-prompt wrapper. */
  shouldPrompt?: boolean;
}
