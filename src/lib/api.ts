import { SearchResponse } from "./types.js";
import { generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";
const DEFAULT_TYPE = "txt";

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
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v1/search`);
    url.searchParams.set("query", query);

    const headers = generateHeaders(clientIp, apiKey);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        const errorMessage = apiKey
          ? "Rate limited due to too many requests. Please try again later."
          : "Rate limited due to too many requests. You can create a free API key at https://context7.com/dashboard for higher rate limits.";
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
 * Fetches documentation context for a specific library
 * @param libraryId The library ID to fetch documentation for
 * @param options Options for the request
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns The documentation text or null if the request fails
 */
export async function fetchLibraryDocumentation(
  libraryId: string,
  options: {
    tokens?: number;
    topic?: string;
  } = {},
  clientIp?: string,
  apiKey?: string
): Promise<string | null> {
  try {
    if (libraryId.startsWith("/")) {
      libraryId = libraryId.slice(1);
    }
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v1/${libraryId}`);
    if (options.tokens) url.searchParams.set("tokens", options.tokens.toString());
    if (options.topic) url.searchParams.set("topic", options.topic);
    url.searchParams.set("type", DEFAULT_TYPE);

    const headers = generateHeaders(clientIp, apiKey, { "X-Context7-Source": "mcp-server" });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        const errorMessage = apiKey
          ? "Rate limited due to too many requests. Please try again later."
          : "Rate limited due to too many requests. You can create a free API key at https://context7.com/dashboard for higher rate limits.";
        console.error(errorMessage);
        return errorMessage;
      }
      if (errorCode === 404) {
        const errorMessage =
          "The library you are trying to access does not exist. Please try with a different library ID.";
        console.error(errorMessage);
        return errorMessage;
      }
      if (errorCode === 401) {
        const errorMessage =
          "Unauthorized. Please check your API key. The API key you provided (possibly incorrect) is: " +
          apiKey +
          ". API keys should start with 'ctx7sk'";
        console.error(errorMessage);
        return errorMessage;
      }
      const errorMessage = `Failed to fetch documentation. Please try again later. Error code: ${errorCode}`;
      console.error(errorMessage);
      return errorMessage;
    }
    const text = await response.text();
    if (!text || text === "No content available" || text === "No context data available") {
      return null;
    }
    return text;
  } catch (error) {
    const errorMessage = `Error fetching library documentation. Please try again later. ${error}`;
    console.error(errorMessage);
    return errorMessage;
  }
}
