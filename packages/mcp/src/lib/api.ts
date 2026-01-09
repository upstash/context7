import { SearchResponse, ContextRequest, ContextResponse } from "./types.js";
import { ClientContext, generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { CONTEXT7_API_BASE_URL } from "./constants.js";

/**
 * Parses error response from the Context7 API
 * Extracts the server's error message, falling back to status-based messages if parsing fails
 * @param response The fetch Response object
 * @param apiKey Optional API key (used for fallback messages)
 * @returns Error message string
 */
async function parseErrorResponse(response: Response, apiKey?: string): Promise<string> {
  try {
    const json = (await response.json()) as { message?: string };
    if (json.message) {
      return json.message;
    }
  } catch {
    // JSON parsing failed, fall through to default
  }

  const status = response.status;
  if (status === 429) {
    return apiKey
      ? "Rate limited or quota exceeded. Upgrade your plan at https://context7.com/plans for higher limits."
      : "Rate limited or quota exceeded. Create a free API key at https://context7.com/dashboard for higher limits.";
  }
  if (status === 404) {
    return "The library you are trying to access does not exist. Please try with a different library ID.";
  }
  if (status === 401) {
    return "Invalid API key. Please check your API key. API keys should start with 'ctx7sk' prefix.";
  }
  return `Request failed with status ${status}. Please try again later.`;
}

const PROXY_URL: string | null =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy ??
  null;

if (PROXY_URL && !PROXY_URL.startsWith("$") && /^(http|https):\/\//i.test(PROXY_URL)) {
  try {
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  } catch (error) {
    console.error(
      `[Context7] Failed to configure proxy agent for provided proxy URL: ${PROXY_URL}:`,
      error
    );
  }
}

/**
 * Searches for libraries matching the given query
 * @param query The user's question or task (used for LLM relevance ranking)
 * @param libraryName The library name to search for in the database
 * @param context Client context including IP, API key, and client info
 * @returns Search results or error
 */
export async function searchLibraries(
  query: string,
  libraryName: string,
  context: ClientContext = {}
): Promise<SearchResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/libs/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("libraryName", libraryName);

    const headers = generateHeaders(context);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, context.apiKey);
      console.error(errorMessage);
      return { results: [], error: errorMessage };
    }
    const searchData = await response.json();
    return searchData as SearchResponse;
  } catch (error) {
    const errorMessage = `Error searching libraries: ${error}`;
    console.error(errorMessage);
    return { results: [], error: errorMessage };
  }
}

/**
 * Fetches intelligent, reranked context for a natural language query
 * @param request The context request parameters (query, libraryId)
 * @param context Client context including IP, API key, and client info
 * @returns Context response with data
 */
export async function fetchLibraryContext(
  request: ContextRequest,
  context: ClientContext = {}
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/context`);
    url.searchParams.set("query", request.query);
    url.searchParams.set("libraryId", request.libraryId);

    const headers = generateHeaders(context);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, context.apiKey);
      console.error(errorMessage);
      return { data: errorMessage };
    }

    const text = await response.text();
    if (!text) {
      return {
        data: "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolve-library-id' with the package name you wish to retrieve documentation for.",
      };
    }
    return { data: text };
  } catch (error) {
    const errorMessage = `Error fetching library context. Please try again later. ${error}`;
    console.error(errorMessage);
    return { data: errorMessage };
  }
}
