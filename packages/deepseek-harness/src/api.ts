const BASE_URL = "https://context7.com/api/v2";

export interface SearchResult {
  id: string;
  title: string;
  description: string;
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
  source?: string;
}

export interface SearchResponse {
  error?: string;
  results: SearchResult[];
  searchFilterApplied?: boolean;
}

function headers(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function errorMessage(response: Response, apiKey?: string): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { message?: string } | undefined;
  if (body?.message) return body.message;

  if (response.status === 429) {
    return apiKey
      ? "Rate limited or quota exceeded. Upgrade your plan at https://context7.com/plans for higher limits."
      : "Rate limited or quota exceeded. Create a free API key at https://context7.com/dashboard for higher limits.";
  }
  if (response.status === 404) {
    return "The requested library does not exist. Resolve the library ID again and choose another result.";
  }
  if (response.status === 401) {
    return "Invalid Context7 API key. API keys should start with the 'ctx7sk' prefix.";
  }
  return `Context7 request failed with status ${response.status}.`;
}

async function request(
  url: URL,
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<Response> {
  const response = await fetch(url, { headers: headers(apiKey), signal });
  if (!response.ok) throw new Error(await errorMessage(response, apiKey));
  return response;
}

export async function searchLibraries(
  query: string,
  libraryName: string,
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<SearchResponse> {
  const url = new URL(`${BASE_URL}/libs/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("libraryName", libraryName);
  const response = await request(url, apiKey, signal);
  return (await response.json()) as SearchResponse;
}

export async function fetchLibraryContext(
  query: string,
  libraryId: string,
  apiKey: string | undefined,
  signal: AbortSignal
): Promise<string> {
  const url = new URL(`${BASE_URL}/context`);
  url.searchParams.set("query", query);
  url.searchParams.set("libraryId", libraryId);
  const response = await request(url, apiKey, signal);
  const text = await response.text();
  if (text) return text;
  return "Documentation not found for this library. Resolve the library ID again and choose another result.";
}
