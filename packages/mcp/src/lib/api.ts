import { ContextRequest, ContextResponse } from "./types.js";
import { generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";

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

  // Fallback for non-JSON responses
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
 * Fetches intelligent, reranked context for a natural language query
 * @param request The context request parameters (query, topic, library, mode)
 * @param clientIp Optional client IP address to include in headers
 * @param apiKey Optional API key for authentication
 * @returns Context response with data
 */
export async function fetchLibraryContext(
  request: ContextRequest,
  clientIp?: string,
  apiKey?: string
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/context`);
    url.searchParams.set("query", request.query);
    if (request.topic) url.searchParams.set("topic", request.topic);
    if (request.library) url.searchParams.set("library", request.library);
    if (request.mode) url.searchParams.set("mode", request.mode);

    const headers = generateHeaders(clientIp, apiKey, { "X-Context7-Source": "mcp-server" });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, apiKey);
      console.error(errorMessage);
      return { data: errorMessage };
    }

    const text = await response.text();
    return { data: text };
  } catch (error) {
    const errorMessage = `Error fetching library context. Please try again later. ${error}`;
    console.error(errorMessage);
    return { data: errorMessage };
  }
}
