import { SearchResponse } from "./types.js";
import { ClientContext, generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { DocumentationMode, DOCUMENTATION_MODES } from "./types.js";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";
const DEFAULT_TYPE = "txt";

/**
 * Parses a Context7-compatible library ID into its components
 * @param libraryId The library ID (e.g., "/vercel/next.js" or "/vercel/next.js/v14.3.0")
 * @returns Object with username, library, and optional tag
 */
function parseLibraryId(libraryId: string): {
  username: string;
  library: string;
  tag?: string;
} {
  const cleaned = libraryId.startsWith("/") ? libraryId.slice(1) : libraryId;
  const parts = cleaned.split("/");

  if (parts.length < 2) {
    throw new Error(
      `Invalid library ID format: ${libraryId}. Expected format: /username/library or /username/library/tag`
    );
  }

  return {
    username: parts[0],
    library: parts[1],
    tag: parts[2],
  };
}

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
 * Search for libraries matching the given query.
 * @param query - Search query string
 * @param context - Client context including IP, API key, and client info
 */
export async function searchLibraries(
  query: string,
  context: ClientContext = {}
): Promise<SearchResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/search`);
    url.searchParams.set("query", query);

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
 * Fetch documentation for a specific library.
 * @param libraryId - Context7-compatible library ID
 * @param docMode - Documentation mode ('code' or 'info')
 * @param options - Pagination and topic options
 * @param context - Client context including IP, API key, and client info
 */
export async function fetchLibraryDocumentation(
  libraryId: string,
  docMode: DocumentationMode,
  options: { page?: number; limit?: number; topic?: string } = {},
  context: ClientContext = {}
): Promise<string | null> {
  try {
    const { username, library, tag } = parseLibraryId(libraryId);

    let urlPath = `${CONTEXT7_API_BASE_URL}/v2/docs/${docMode}/${username}/${library}`;
    if (tag) {
      urlPath += `/${tag}`;
    }

    const url = new URL(urlPath);
    url.searchParams.set("type", DEFAULT_TYPE);
    if (options.topic) url.searchParams.set("topic", options.topic);
    if (options.page) url.searchParams.set("page", options.page.toString());
    if (options.limit) url.searchParams.set("limit", options.limit.toString());

    const headers = generateHeaders(context);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, context.apiKey);
      console.error(errorMessage);
      return errorMessage;
    }
    const text = await response.text();
    if (!text || text === "No content available" || text === "No context data available") {
      const suggestion =
        docMode === DOCUMENTATION_MODES.CODE
          ? " Try mode='info' for guides and tutorials."
          : " Try mode='code' for API references and code examples.";
      return `No ${docMode} documentation available for this library.${suggestion}`;
    }
    return text;
  } catch (error) {
    const errorMessage = `Error fetching library documentation. Please try again later. ${error}`;
    console.error(errorMessage);
    return errorMessage;
  }
}
