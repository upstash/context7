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
}

export interface SearchResponse {
  error?: string;
  results: SearchResult[];
}

// Version state is still needed for validating search results
export type DocumentState = "initial" | "finalized" | "error" | "delete";

/**
 * Documentation modes for fetching library documentation
 */
export const DOCUMENTATION_MODES = {
  CODE: "code",
  INFO: "info",
} as const;

export type DocumentationMode = (typeof DOCUMENTATION_MODES)[keyof typeof DOCUMENTATION_MODES];
