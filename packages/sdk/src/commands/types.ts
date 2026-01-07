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

export interface GetContextOptions {
  /**
   * Response format.
   * - "json": Returns Documentation[] array (default)
   * - "txt": Returns formatted text string
   * @default "json"
   */
  type?: "json" | "txt";
}

export interface SearchLibraryOptions {
  /**
   * Response format.
   * - "json": Returns Library[] array (default)
   * - "txt": Returns formatted text string
   * @default "json"
   */
  type?: "json" | "txt";
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
