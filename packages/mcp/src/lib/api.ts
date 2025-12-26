import { SearchResponse } from "./types.js";
import { generateHeaders } from "./encryption.js";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { DocumentationMode, DOCUMENTATION_MODES } from "./types.js";
import crypto from "crypto";

const SERVER_VERSION = "1.0.33";

/**
 * Client context for telemetry headers
 */
export interface ClientContext {
  clientIp?: string;
  apiKey?: string;
  clientInfo?: {
    ide?: string;
    version?: string;
  };
  transport?: "stdio" | "http";
}

// Session ID for stdio mode (stable for process lifetime)
let stdioSessionId: string | null = null;

function getOrCreateStdioSessionId(): string {
  if (!stdioSessionId) {
    stdioSessionId = `stdio_session_${crypto.randomUUID()}`;
  }
  return stdioSessionId;
}

/**
 * Generate a client ID from context for unique user tracking
 */
function generateClientId(ctx: ClientContext): string {
  // Priority 1: API key hash (authenticated user)
  if (ctx.apiKey) {
    const hash = crypto.createHash("sha256").update(ctx.apiKey).digest("hex");
    return `apikey_${hash.substring(0, 16)}`;
  }

  // Priority 2: Client IP hash (HTTP anonymous user)
  if (ctx.clientIp) {
    const hash = crypto.createHash("sha256").update(ctx.clientIp).digest("hex");
    return `ip_${hash.substring(0, 16)}`;
  }

  // Priority 3: Session ID (stdio mode)
  return getOrCreateStdioSessionId();
}

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
 * Searches for libraries matching the given query
 * @param query The search query
 * @param context Client context for headers (IP, API key, client info)
 * @returns Search results or error
 */
export async function searchLibraries(
  query: string,
  context: ClientContext = {}
): Promise<SearchResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/search`);
    url.searchParams.set("query", query);

    const clientId = generateClientId(context);
    const baseHeaders = generateHeaders(context.clientIp, context.apiKey);

    const headers: Record<string, string> = {
      ...baseHeaders,
      "X-Context7-Source": "mcp-server",
      "X-Context7-Server-Version": SERVER_VERSION,
      "X-Context7-Client-Id": clientId,
    };

    if (context.clientInfo?.ide) {
      headers["X-Context7-Client-IDE"] = context.clientInfo.ide;
    }
    if (context.clientInfo?.version) {
      headers["X-Context7-Client-Version"] = context.clientInfo.version;
    }
    if (context.transport) {
      headers["X-Context7-Transport"] = context.transport;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response, context.apiKey);
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
 * @param context Client context for headers (IP, API key, client info)
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
  context: ClientContext = {}
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

    const clientId = generateClientId(context);
    const baseHeaders = generateHeaders(context.clientIp, context.apiKey);

    const headers: Record<string, string> = {
      ...baseHeaders,
      "X-Context7-Source": "mcp-server",
      "X-Context7-Server-Version": SERVER_VERSION,
      "X-Context7-Client-Id": clientId,
    };

    if (context.clientInfo?.ide) {
      headers["X-Context7-Client-IDE"] = context.clientInfo.ide;
    }
    if (context.clientInfo?.version) {
      headers["X-Context7-Client-Version"] = context.clientInfo.version;
    }
    if (context.transport) {
      headers["X-Context7-Transport"] = context.transport;
    }

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
