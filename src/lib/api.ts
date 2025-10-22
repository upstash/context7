import { SearchResponse } from "./types.js";
import { generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";
const CONTEXT7_API_V1_URL = CONTEXT7_API_BASE_URL + "/v1";
const CONTEXT7_API_V2_URL = CONTEXT7_API_BASE_URL + "/v2";

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
    const url = new URL(`${CONTEXT7_API_V1_URL}/search`);
    url.searchParams.set("query", query);

    const headers = generateHeaders(clientIp, apiKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        const errorMessage = "Rate limited due to too many requests. Please try again later.";
        console.error(errorMessage);
        return {
          results: [],
          error: errorMessage,
        } as SearchResponse;
      }
      if (errorCode === 401) {
        const errorMessage =
          "Unauthorized. Please check your API key. The API key you provided (possibly incorrect) is: " +
          apiKey +
          ". API keys should start with 'ctx7sk'";
        console.error(errorMessage);
        return {
          results: [],
          error: errorMessage,
        } as SearchResponse;
      }
      const errorMessage = `Failed to search libraries. Please try again later. Error code: ${errorCode}`;
      console.error(errorMessage);
      return {
        results: [],
        error: errorMessage,
      } as SearchResponse;
    }
    return await response.json();
  } catch (error) {
    const errorMessage = `Error searching libraries: ${error}`;
    console.error(errorMessage);
    return { results: [], error: errorMessage } as SearchResponse;
  }
}

/**
 * Fetches code documentation (API references, code examples) for a specific library using V2 API
 * @param libraryId The Context7-compatible library ID (e.g., "/vercel/next.js")
 * @param options Options for the request
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns The code documentation text or error message
 */
export async function fetchCodeDocs(
  libraryId: string,
  options: {
    topic?: string;
    page?: number;
    limit?: number;
  } = {},
  clientIp?: string,
  apiKey?: string
): Promise<string> {
  try {
    const { username, library, tag } = parseLibraryId(libraryId);

    // Build URL path
    let urlPath = `${CONTEXT7_API_V2_URL}/docs/code/${username}/${library}`;
    if (tag) {
      urlPath += `/${tag}`;
    }

    const url = new URL(urlPath);
    url.searchParams.set("type", "txt");
    if (options.topic) url.searchParams.set("topic", options.topic);
    if (options.page) url.searchParams.set("page", options.page.toString());
    if (options.limit) url.searchParams.set("limit", options.limit.toString());

    const headers = generateHeaders(clientIp, apiKey, { "X-Context7-Source": "mcp-server" });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        return "Rate limited due to too many requests. Please try again later.";
      }
      if (errorCode === 404) {
        return "The library you are trying to access does not exist. Please try with a different library ID.";
      }
      if (errorCode === 401) {
        return `Unauthorized. Please check your API key. The API key you provided (possibly incorrect) is: ${apiKey}. API keys should start with 'ctx7sk'`;
      }
      return `Failed to fetch code documentation. Please try again later. Error code: ${errorCode}`;
    }

    const text = await response.text();
    if (!text || text === "No content available" || text === "No context data available") {
      return "No code documentation available for this library.";
    }

    return text;
  } catch (error) {
    if (error instanceof Error) {
      return `Error fetching code documentation: ${error.message}`;
    }
    return `Error fetching code documentation: ${error}`;
  }
}

/**
 * Fetches informational documentation (guides, tutorials) for a specific library using V2 API
 * @param libraryId The Context7-compatible library ID (e.g., "/vercel/next.js")
 * @param options Options for the request
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns The informational documentation text or error message
 */
export async function fetchInfoDocs(
  libraryId: string,
  options: {
    topic?: string;
    page?: number;
    limit?: number;
  } = {},
  clientIp?: string,
  apiKey?: string
): Promise<string> {
  try {
    const { username, library, tag } = parseLibraryId(libraryId);

    // Build URL path
    let urlPath = `${CONTEXT7_API_V2_URL}/docs/info/${username}/${library}`;
    if (tag) {
      urlPath += `/${tag}`;
    }

    const url = new URL(urlPath);
    url.searchParams.set("type", "txt");
    if (options.topic) url.searchParams.set("topic", options.topic);
    if (options.page) url.searchParams.set("page", options.page.toString());
    if (options.limit) url.searchParams.set("limit", options.limit.toString());

    const headers = generateHeaders(clientIp, apiKey, { "X-Context7-Source": "mcp-server" });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        return "Rate limited due to too many requests. Please try again later.";
      }
      if (errorCode === 404) {
        return "The library you are trying to access does not exist. Please try with a different library ID.";
      }
      if (errorCode === 401) {
        return `Unauthorized. Please check your API key. The API key you provided (possibly incorrect) is: ${apiKey}. API keys should start with 'ctx7sk'`;
      }
      return `Failed to fetch informational documentation. Please try again later. Error code: ${errorCode}`;
    }

    const text = await response.text();
    if (!text || text === "No content available" || text === "No context data available") {
      return "No informational documentation available for this library.";
    }

    return text;
  } catch (error) {
    if (error instanceof Error) {
      return `Error fetching informational documentation: ${error.message}`;
    }
    return `Error fetching informational documentation: ${error}`;
  }
}
