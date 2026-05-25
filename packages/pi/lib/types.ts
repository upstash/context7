// Copied verbatim from @upstash/context7-mcp (packages/mcp/src/lib/types.ts)
// to keep pi's wire format in lockstep with MCP. Update both together.

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

export type DocumentState = "initial" | "finalized" | "error" | "delete";
