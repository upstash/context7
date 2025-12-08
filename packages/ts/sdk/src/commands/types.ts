export interface Context7Config {
  apiKey?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: "initial" | "finalized" | "processing" | "error" | "delete";
  totalTokens: number;
  totalSnippets: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface APIResponseMetadata {
  authentication: "none" | "personal" | "team";
}

export interface SearchLibraryResponse {
  results: SearchResult[];
  metadata: APIResponseMetadata;
}

export interface CodeExample {
  language: string;
  code: string;
}

export interface CodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeTokens: number;
  codeId: string;
  pageTitle: string;
  codeList: CodeExample[];
}

export interface InfoSnippet {
  pageId?: string;
  breadcrumb?: string;
  content: string;
  contentTokens: number;
}

export interface Pagination {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface DocsResponseBase {
  pagination: Pagination;
  totalTokens: number;
}

export interface CodeDocsResponse extends DocsResponseBase {
  snippets: CodeSnippet[];
}

export interface InfoDocsResponse extends DocsResponseBase {
  snippets: InfoSnippet[];
}

export interface TextDocsResponse extends DocsResponseBase {
  content: string;
}

export interface GetDocsOptions {
  /**
   * Library version to fetch docs for.
   * @example "18.0.0"
   */
  version?: string;
  /**
   * Page number for pagination.
   */
  page?: number;
  /**
   * Filter docs by topic.
   */
  topic?: string;
  /**
   * Number of results per page.
   */
  limit?: number;
  /**
   * Type of documentation to fetch.
   * @default "code"
   */
  mode?: "info" | "code";
  /**
   * Response format.
   * @default "json"
   */
  format?: "json" | "txt";
}

export type QueryParams = Record<string, string | number | boolean | undefined>;
