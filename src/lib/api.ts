import { SearchResponse } from "./types.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";
const DEFAULT_TYPE = "txt";

// Pick up proxy configuration in a variety of common env var names.
let PROXY_URL: string | null =
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
    setGlobalDispatcher(new ProxyAgent(PROXY_URL) as any);
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
 * @returns Search results or null if the request fails
 */
export async function searchLibraries(query: string): Promise<SearchResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v1/search`);
    url.searchParams.set("query", query);
    const response = await fetch(url);
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        console.error(`Rate limited due to too many requests. Please try again later.`);
        return {
          results: [],
          error: `Rate limited due to too many requests. Please try again later.`,
        } as SearchResponse;
      }
      console.error(`Failed to search libraries. Please try again later. Error code: ${errorCode}`);
      return {
        results: [],
        error: `Failed to search libraries. Please try again later. Error code: ${errorCode}`,
      } as SearchResponse;
    }
    return await response.json();
  } catch (error) {
    console.error("Error searching libraries:", error);
    return { results: [], error: `Error searching libraries: ${error}` } as SearchResponse;
  }
}

/**
 * Fetches documentation context for a specific library
 * @param libraryId The library ID to fetch documentation for
 * @param options Options for the request
 * @returns The documentation text or null if the request fails
 */
export async function fetchLibraryDocumentation(
  libraryId: string,
  options: {
    tokens?: number;
    topic?: string;
  } = {}
): Promise<string | null> {
  try {
    if (libraryId.startsWith("/")) {
      libraryId = libraryId.slice(1);
    }
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v1/${libraryId}`);
    if (options.tokens) url.searchParams.set("tokens", options.tokens.toString());
    if (options.topic) url.searchParams.set("topic", options.topic);
    url.searchParams.set("type", DEFAULT_TYPE);
    const response = await fetch(url, {
      headers: {
        "X-Context7-Source": "mcp-server",
      },
    });
    if (!response.ok) {
      const errorCode = response.status;
      if (errorCode === 429) {
        const errorMessage = `Rate limited due to too many requests. Please try again later.`;
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
