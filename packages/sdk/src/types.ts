export interface Context7Config {
  apiKey: string;
}

export interface SearchLibraryOptions {
  limit?: number;
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

export interface CodeSnippetsResponse {
  snippets: CodeSnippet[];
  totalTokens: number;
  pagination: Pagination;
  metadata: APIResponseMetadata;
}

export interface InfoSnippetsResponse {
  snippets: InfoSnippet[];
  totalTokens: number;
  pagination: Pagination;
  metadata: APIResponseMetadata;
}

export interface GetDocsOptions {
  version?: string;
  page?: number;
  topic?: string;
  limit?: number;
  docType?: "info" | "code";
  format?: "json" | "txt";
}

export type GetLibraryResponse = SearchResult;

export interface AddLibraryParams {
  docsRepoUrl?: string;
  llmstxtUrl?: string;
  branch?: string;
  folders?: string[];
  excludeFolders?: string[];
  apiKey?: string;
}

export interface AddLibraryResponse {
  projectName: string;
  metadata: {
    authentication: string;
  };
  message: string;
  status: "processing" | "finalized";
}
