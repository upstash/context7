export interface Context7Config {
  apiKey?: string;
}

export type DocumentState = "initial" | "finalized" | "error" | "delete";

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

export interface SearchLibraryResponse {
  results: SearchResult[];
  error?: string;
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

export interface ContextJsonResponse {
  selectedLibrary: string;
  codeSnippets: CodeSnippet[];
  infoSnippets: InfoSnippet[];
  rules?: string[];
}

export interface ContextTextResponse {
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
