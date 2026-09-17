import type { ApiCodeSnippet, ApiInfoSnippet } from "@commands/get-context/types";

export interface ApiSearchCodeSnippet extends ApiCodeSnippet {
  libraryId: string;
}

export interface ApiSearchInfoSnippet extends ApiInfoSnippet {
  libraryId: string;
}

export interface ApiSearchJsonResponse {
  codeSnippets: ApiSearchCodeSnippet[];
  infoSnippets: ApiSearchInfoSnippet[];
}
