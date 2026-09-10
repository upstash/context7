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
};

export type ContextResponse = {
  data: string;
};

export type AutoContextOptions = {
  /** Fuzzy package, product, repository, or documentation-domain hint. */
  library?: string;
  /** Exact Context7 ID supplied by the user or another trusted source. */
  libraryId?: string;
  /** Version paired with exactly one library or libraryId hint. */
  version?: string;
};

export type AutoContextResponse = {
  data: string;
  error?: string;
  libraryIds?: string[];
  status?: "complete" | "partial" | "not-found" | "failed";
  retryable?: boolean;
  retryReason?: string;
  suggestedAction?: "none" | "retryLater" | "refineQuery" | "checkLibraryOrVersion";
};

export interface ClientContext {
  clientIp?: string;
  apiKey?: string;
  clientInfo?: {
    ide?: string;
    version?: string;
  };
  plugin?: string;
  transport?: "stdio" | "http";
  sessionId?: string;
  /** Mutable: set by the upstream API layer when the backend signals the
   *  client should be prompted to sign in. Read by the auth-prompt wrapper. */
  shouldPrompt?: boolean;
}
