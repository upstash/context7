export interface Context7Config {
  apiKey?: string;
}

/**
 * A library available in Context7
 */
export interface Library {
  /** Context7 library ID (e.g., "/facebook/react") */
  id: string;
  /** Library display name */
  name: string;
  /** Library description */
  description: string;
  /** Available versions/tags */
  versions?: string[];
}

export interface SearchLibraryResponse {
  results: Library[];
  error?: string;
}

/**
 * A piece of documentation content
 */
export interface Documentation {
  /** Title of the documentation section */
  title: string;
  /** The documentation content */
  content: string;
  /** Programming language (for code snippets) */
  language?: string;
}

export interface ContextJsonResponse {
  /** The library ID that was queried */
  library: string;
  /** Documentation snippets */
  docs: Documentation[];
  /** Library-specific rules/guidelines */
  rules?: string[];
}

export interface ContextTextResponse {
  /** Plain text documentation content */
  data: string;
}

export interface GetContextOptions {
  /**
   * Response format.
   * @default "txt"
   */
  type?: "json" | "txt";
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
