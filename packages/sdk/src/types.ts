export interface Context7Config {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  encryptionKey?: string;
  clientIp?: string;
}

export interface SearchLibraryOptions {
  limit?: number;
  apiKey?: string;
  clientIp?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: "initial" | "finalized" | "error" | "delete";
  totalTokens: number;
  totalSnippets: number;
  totalPages: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface SearchLibraryResponse {
  error?: string;
  results: SearchResult[];
}

export interface GetDocsOptions {
  version?: string;
  page?: number;
  topic?: string;
  limit?: number;
  type?: "info" | "code";
  apiKey?: string;
  clientIp?: string;
}

export type DocsResponse = string;

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
