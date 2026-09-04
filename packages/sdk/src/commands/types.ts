import type { CacheSetting, Context7Fetch, Context7ResponseMetadata, RetryConfig } from "@http";

export interface Context7Config {
  apiKey?: string;
  /** Override the Context7 API URL, for example when using a proxy. */
  baseUrl?: string;
  /** Retry transient network and HTTP failures. Set to false to disable retries. */
  retry?: RetryConfig;
  /** Native fetch cache mode. Defaults to "no-store". */
  cache?: CacheSetting;
  /** Request timeout in milliseconds. Set to false to disable it. @default 30000 */
  timeout?: number | false;
  /** Abort all requests made by this client when this signal aborts. */
  signal?: AbortSignal | (() => AbortSignal);
  /** Custom fetch implementation for non-standard runtimes, testing, or instrumentation. */
  fetch?: Context7Fetch;
  /** Additional headers sent with every request. Authorization cannot be overridden. */
  headers?: Record<string, string>;
  /** Observe response status, request IDs, rate limits, and retry attempts. */
  onResponse?: (metadata: Context7ResponseMetadata) => void;
}

export interface Context7RequestOptions {
  /** Abort this request. */
  signal?: AbortSignal;
  /** Override the client timeout for this request. Set to false to disable it. */
  timeout?: number | false;
  /** Override the native fetch cache mode for this request. */
  cache?: CacheSetting;
}

/**
 * A library available in Context7
 */
export interface Library {
  /** Context7 library ID (e.g., "/react/react") */
  id: string;
  /** Library display name */
  name: string;
  /** Library description */
  description: string;
  /** Number of documentation snippets available */
  totalSnippets: number;
  /** Source reputation score (0-10) */
  trustScore: number;
  /** Quality indicator score (0-100) */
  benchmarkScore: number;
  /** Available versions/tags */
  versions?: string[];
}

/**
 * A piece of documentation content
 */
export interface Documentation {
  /** Title of the documentation snippet */
  title: string;
  /** The documentation content (may include code blocks in markdown format) */
  content: string;
  /** Source URL or identifier for the snippet */
  source: string;
}

export interface GetContextOptions extends Context7RequestOptions {
  /**
   * Response format.
   * - "json": Returns Documentation[] array (default)
   * - "txt": Returns formatted text string
   * @default "json"
   */
  type?: "json" | "txt";
}

export interface SearchLibraryOptions extends Context7RequestOptions {
  /**
   * Response format.
   * - "json": Returns Library[] array (default)
   * - "txt": Returns formatted text string
   * @default "json"
   */
  type?: "json" | "txt";
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
