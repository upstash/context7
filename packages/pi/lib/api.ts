// Adapted from @upstash/context7-mcp (packages/mcp/src/lib/api.ts) — kept
// minimal for pi: no proxy/CA-cert handling (pi controls the HTTP runtime),
// no per-request client context (pi passes through env). Keep wire format
// and error messages aligned with MCP.

import type { SearchResponse } from "./types";

const BASE_URL = "https://context7.com/api";

function authHeaders(): Record<string, string> {
  const apiKey = process.env.CONTEXT7_API_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json.message) return json.message;
  } catch {
    // JSON parsing failed, fall through to status-based message
  }

  const hasKey = Boolean(process.env.CONTEXT7_API_KEY);
  if (response.status === 429) {
    return hasKey
      ? "Rate limited or quota exceeded. Upgrade your plan at https://context7.com/plans for higher limits."
      : "Rate limited or quota exceeded. Create a free API key at https://context7.com/dashboard for higher limits.";
  }
  if (response.status === 404) {
    return "The library you are trying to access does not exist. Please try with a different library ID.";
  }
  if (response.status === 401) {
    return "Invalid API key. Please check your API key. API keys should start with 'ctx7sk' prefix.";
  }
  return `Request failed with status ${response.status}. Please try again later.`;
}

export async function searchLibraries(query: string, libraryName: string): Promise<SearchResponse> {
  const url = new URL(`${BASE_URL}/v2/libs/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("libraryName", libraryName);

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    return { results: [], error: await parseErrorResponse(response) };
  }
  return (await response.json()) as SearchResponse;
}

export async function fetchLibraryContext(query: string, libraryId: string): Promise<string> {
  const url = new URL(`${BASE_URL}/v2/context`);
  url.searchParams.set("query", query);
  url.searchParams.set("libraryId", libraryId);

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    return parseErrorResponse(response);
  }

  const text = await response.text();
  if (!text) {
    return "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolve-library-id' with the package name you wish to retrieve documentation for.";
  }
  return text;
}
