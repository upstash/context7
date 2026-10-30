import {
  SearchResponse,
  ContextRequest,
  ContextResponse,
  ClientContext,
  CodeRequest,
  CodeResponse,
} from "./types.js";
import { generateHeaders } from "./encryption.js";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { readFileSync } from "fs";
import tls from "tls";
import { observeUpstreamRequest } from "./telemetry-runtime.js";
import {
  INVALID_OAUTH_TOKEN_ERROR_CODE,
  isOpaqueOAuthToken,
  rememberInvalidOAuthToken,
} from "./oauth-token-validation.js";
import { isClerkOAuthJwt } from "./jwt.js";

/**
 * Ceiling on a single Context7 API call. Without a signal a stalled backend
 * call rides undici's ~300s default before failing. 60s is generous for these
 * vector queries: p99.9 is ~3.2s, and no request exceeded 30s across a full
 * day of production traffic.
 */
const API_TIMEOUT_MS = 60_000;

const EXPIRED_SIGN_IN_MESSAGE =
  "Your Context7 sign-in expired. Retry the request so your MCP client can refresh the sign-in.";

/**
 * Parses error response from the Context7 API
 * Extracts the server's error message, falling back to status-based messages if parsing fails
 * @param response The fetch Response object
 * @param context Client context (transport and credential shape pick the message)
 * @returns Error message string
 */
async function parseErrorResponse(response: Response, context: ClientContext): Promise<string> {
  const { apiKey } = context;
  let json: { error?: string; message?: string } | undefined;
  try {
    json = (await response.json()) as { error?: string; message?: string };
  } catch {
    // JSON parsing failed, fall through to default
  }

  const status = response.status;
  // On the hosted transport the auth gate answers the next request with an HTTP
  // 401 so the client refreshes its sign-in; the tool text should say so rather
  // than talk about API keys. stdio keeps the API's own message: there is no
  // HTTP status to act on and the credential there is a configured key.
  if (
    status === 401 &&
    context.transport === "http" &&
    (isOpaqueOAuthToken(apiKey) || isClerkOAuthJwt(apiKey)) &&
    (json?.error === INVALID_OAUTH_TOKEN_ERROR_CODE || json?.error === undefined)
  ) {
    rememberInvalidOAuthToken(apiKey);
    return EXPIRED_SIGN_IN_MESSAGE;
  }
  if (json?.message) {
    return json.message;
  }

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

const CUSTOM_CA_CERTS: string | undefined = process.env.NODE_EXTRA_CA_CERTS;

export function getDefaultCACertificates(): string[] {
  if (typeof tls.getCACertificates === "function") {
    return tls.getCACertificates("default");
  }

  return [...tls.rootCertificates];
}

export function loadCustomCACerts(customCACertsPath = CUSTOM_CA_CERTS): string[] | undefined {
  if (!customCACertsPath) return undefined;
  try {
    const customCa = readFileSync(customCACertsPath, "utf-8");
    return [...getDefaultCACertificates(), customCa];
  } catch (error) {
    console.error(
      `[Context7] Failed to load custom CA certificates from ${customCACertsPath}:`,
      error
    );
    return undefined;
  }
}

if (PROXY_URL && !PROXY_URL.startsWith("$") && /^(http|https):\/\//i.test(PROXY_URL)) {
  try {
    const ca = loadCustomCACerts();
    setGlobalDispatcher(
      new ProxyAgent({
        uri: PROXY_URL,
        ...(ca ? { requestTls: { ca }, proxyTls: { ca } } : {}),
      })
    );
  } catch (error) {
    console.error(
      `[Context7] Failed to configure proxy agent for provided proxy URL: ${PROXY_URL}:`,
      error
    );
  }
} else if (CUSTOM_CA_CERTS) {
  const ca = loadCustomCACerts();
  if (ca) {
    try {
      setGlobalDispatcher(new Agent({ connect: { ca } }));
    } catch (error) {
      console.error(`[Context7] Failed to configure custom CA certificates:`, error);
    }
  }
}

function readPromptSignal(response: Response, context: ClientContext): void {
  if (response.headers.get("X-Context7-Auth-Prompt") === "1") {
    context.shouldPrompt = true;
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
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "search_libraries",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response) => {
        readPromptSignal(response, context);
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, context);
          console.error(errorMessage);
          return { results: [], error: errorMessage };
        }
        const searchData = await response.json();
        return searchData as SearchResponse;
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error searching libraries: ${error}`;
    console.error(errorMessage);
    return { results: [], error: errorMessage };
  }
}

/**
 * Fetches intelligent, reranked context for a natural language query
 * @param request The context request parameters (query, libraryId, language)
 * @param context Client context including IP, API key, and client info
 * @returns Context response with data
 */
/**
 * Queries a library's source code at the version its docs were built from.
 * A 202 means the source is still being indexed: that is a normal answer
 * telling the agent to call again, not an error.
 */
export async function fetchLibraryCode(
  request: CodeRequest,
  context: ClientContext = {}
): Promise<CodeResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/code`);
    url.searchParams.set("libraryId", request.libraryId);
    url.searchParams.set("query", request.query);
    if (request.type) url.searchParams.set("type", request.type);
    if (request.path) url.searchParams.set("path", request.path);
    if (request.version) url.searchParams.set("version", request.version);
    if (request.limit) url.searchParams.set("limit", String(request.limit));

    const headers = generateHeaders(context);
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "fetch_code",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response) => {
        readPromptSignal(response, context);
        if (response.status === 202) {
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
            retryAfter?: number;
          };
          const wait = body.retryAfter ?? Number(response.headers.get("Retry-After") ?? 30);
          return {
            data: `${body.message ?? "The library source is being indexed."} This is not an error. Call query-code again with the same arguments in about ${wait} seconds, or use query-docs meanwhile.`,
            outcome: "not_found",
            retryable: true,
          };
        }
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, context);
          console.error(errorMessage);
          return { data: errorMessage, outcome: "error" };
        }
        const text = await response.text();
        if (!text) return { data: "No source results for this query.", outcome: "not_found" };
        const empty = /^No definition named /m.test(text) && /No text matches either\./.test(text);
        return { data: text, outcome: empty ? "not_found" : "success" };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error querying library source code. Please try again later. ${error}`;
    console.error(errorMessage);
    return { data: errorMessage, outcome: "error" };
  }
}

export async function fetchLibraryContext(
  request: ContextRequest,
  context: ClientContext = {}
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/context`);
    url.searchParams.set("query", request.query);
    url.searchParams.set("libraryId", request.libraryId);
    if (request.language) url.searchParams.set("language", request.language);

    const headers = generateHeaders(context);
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "fetch_context",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response) => {
        readPromptSignal(response, context);
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, context);
          console.error(errorMessage);
          return { data: errorMessage, outcome: "error" };
        }

        const text = await response.text();
        if (!text) {
          return {
            data: "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolve-library-id' with the package name you wish to retrieve documentation for.",
            outcome: "not_found",
          };
        }
        return { data: text, outcome: "success" };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error fetching library context. Please try again later. ${error}`;
    console.error(errorMessage);
    return { data: errorMessage, outcome: "error" };
  }
}
