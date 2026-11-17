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
  versions?: string[];
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

/** Arms of the server instructions A/B test. */
export type InstructionsVariant = "control" | "treatment";

export interface InstructionsArm {
  /** The test this arm belongs to, so reruns and salt changes never share counters. */
  experimentId: string;
  variant: InstructionsVariant;
  /** Salted hash of the caller identity: the unit the server randomizes and the app counts. */
  unit: string;
  /** Configured share of callers in control, for the app's split check. */
  controlPercent: number;
  /**
   * True for a stable identity (API key or user ID). False for an IP network or an opaque
   * token, whose arm can change between requests.
   */
  signedIn: boolean;
}

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
  /** The caller's arm in the server instructions A/B test; sent on API calls (see encryption.ts). */
  instructionsArm?: InstructionsArm;
  /** Mutable: set by the upstream API layer when the backend signals the
   *  client should be prompted to sign in. Read by the auth-prompt wrapper. */
  shouldPrompt?: boolean;
}
