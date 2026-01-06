import { SearchResponse } from "./types.js";
import { generateHeaders } from "./encryption.js";
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
  // Remove leading slash if present
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
    tag: parts[2], // undefined if not present
  };
}

/**
 * Generates appropriate error messages based on HTTP status codes
 * @param errorCode The HTTP error status code
 * @param apiKey Optional API key (used for rate limit message)
 * @returns Error message string
 */
function createErrorMessage(errorCode: number, apiKey?: string): string {
  switch (errorCode) {
    case 429:
      return apiKey
        ? "Rate limited due to too many requests. Please try again later."
        : "Rate limited due to too many requests. You can create a free API key at https://context7.com/dashboard for higher rate limits.";
    case 404:
      return "The library you are trying to access does not exist. Please try with a different library ID.";
    case 401:
      if (!apiKey) {
        return "Unauthorized. Please provide an API key.";
      }
      return `Unauthorized. Please check your API key. API keys should start with 'ctx7sk'`;
    default:
      return `Failed to fetch documentation. Please try again later. Error code: ${errorCode}`;
  }
}

// Pick up proxy configuration in a variety of common env var names.
const PROXY_URL: string | null =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy ??
  null;

if (PROXY_URL && !PROXY_URL.startsWith("$") && /^(http|https):\/\//i.test(PROXY_URL)) {
  try {
    // Configure a global proxy agent once at startup. Subsequent fetch calls will
    // automatically use this dispatcher.
    // Using `any` cast because ProxyAgent implements the Dispatcher interface but
    // TS may not infer it correctly in some versions.
    setGlobalDispatcher(new ProxyAgent(PROXY_URL));
  } catch (error) {
    // Don't crash the app if proxy initialisation fails – just log a warning.
    console.error(
      `[Context7] Failed to configure proxy agent for provided proxy URL: ${PROXY_URL}:`,
      error
    );
  }
}

/**
 * Searches for libraries matching the given query
 * @param query The search query
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns Search results or null if the request fails
 */
export async function searchLibraries(
  query: string,
  clientIp?: string,
  apiKey?: string
): Promise<SearchResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/search`);
    url.searchParams.set("query", query);

    const headers = generateHeaders(clientIp, apiKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      const errorMessage = createErrorMessage(errorCode, apiKey);
      console.error(errorMessage);
      return {
        results: [],
        error: errorMessage,
      } as SearchResponse;
    }
    const searchData = await response.json();
    return searchData as SearchResponse;
  } catch (error) {
    const errorMessage = `Error searching libraries: ${error}`;
    console.error(errorMessage);
    return { results: [], error: errorMessage } as SearchResponse;
  }
}

/**
 * Fetches documentation context for a specific library
 * @param libraryId The library ID to fetch documentation for
 * @param docMode Documentation mode (CODE for API references and code examples, INFO for conceptual guides)
 * @param options Optional request parameters (page, limit, topic)
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns The documentation text or null if the request fails
 */
export async function fetchLibraryDocumentation(
  libraryId: string,
  docMode: DocumentationMode,
  options: {
    page?: number;
    limit?: number;
    topic?: string;
  } = {},
  clientIp?: string,
  apiKey?: string
): Promise<string | null> {
  try {
    const { username, library, tag } = parseLibraryId(libraryId);

    // Build URL path
    let urlPath = `${CONTEXT7_API_BASE_URL}/v2/docs/${docMode}/${username}/${library}`;
    if (tag) {
      urlPath += `/${tag}`;
    }

    const url = new URL(urlPath);
    url.searchParams.set("type", DEFAULT_TYPE);
    if (options.topic) url.searchParams.set("topic", options.topic);
    if (options.page) url.searchParams.set("page", options.page.toString());
    if (options.limit) url.searchParams.set("limit", options.limit.toString());

    const headers = generateHeaders(clientIp, apiKey, { "X-Context7-Source": "mcp-server" });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      const errorMessage = createErrorMessage(errorCode, apiKey);
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
