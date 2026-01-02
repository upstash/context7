export interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  versions?: string[];
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
}

export interface ApiSearchResponse {
  results: ApiSearchResult[];
}
