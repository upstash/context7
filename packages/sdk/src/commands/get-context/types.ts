export interface ApiCodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeList: { language: string; code: string }[];
  codeId: string;
  codeTokens?: number;
  pageTitle?: string;
}

export interface ApiInfoSnippet {
  content: string;
  breadcrumb?: string;
  pageId: string;
  contentTokens?: number;
}

export interface ApiContextJsonResponse {
  codeSnippets: ApiCodeSnippet[];
  infoSnippets: ApiInfoSnippet[];
}
