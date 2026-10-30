import type { ToolCallOutcome } from "./tool-names.js";

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

export const CODE_QUERY_TYPES = ["definition", "references", "outline", "text", "source"] as const;
export type CodeQueryType = (typeof CODE_QUERY_TYPES)[number];

export type CodeRequest = {
  libraryId: string;
  query: string;
  type?: CodeQueryType;
  path?: string;
  version?: string;
  limit?: number;
};

export type CodeResponse = ContextResponse & {
  /** The source is still being indexed: not an error, the caller should retry. */
  retryable?: boolean;
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
  /** Mutable: set by the upstream API layer when the backend signals the
   *  client should be prompted to sign in. Read by the auth-prompt wrapper. */
  shouldPrompt?: boolean;
}
