export interface SkillFile {
  path: string;
  content: string;
}

export interface LibrarySearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  totalSnippets: number;
  totalTokens?: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface LibrarySearchResponse {
  results: LibrarySearchResult[];
  searchFilterApplied?: boolean;
  error?: string;
  message?: string;
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

export interface ContextResponse {
  codeSnippets: CodeSnippet[];
  infoSnippets: InfoSnippet[];
  error?: string;
  message?: string;
  redirectUrl?: string;
}
