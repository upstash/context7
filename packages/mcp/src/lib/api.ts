import {
  SearchResponse,
  ContextRequest,
  ContextResponse,
  ClientContext,
  CodeRequest,
  DiffRequest,
} from "./types.js";
import type { DocsFeedback } from "./research-preview-tools.js";
import type { ToolCallOutcome } from "./tool-names.js";
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
 * Sends feedback on a library's documentation to the Context7 API
 * @param feedback The feedback the agent or user gave
 * @param context Client context including IP, API key, and client info
 * @returns The text to show and whether the API stored the feedback
 */
export async function submitDocsFeedback(
  feedback: DocsFeedback,
  context: ClientContext = {}
): Promise<{ text: string; outcome: ToolCallOutcome }> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/feedback`);
    const headers = { ...generateHeaders(context), "Content-Type": "application/json" };
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "submit_feedback",
      () =>
        fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(feedback),
          signal: abortSignal,
        }),
      async (response) => {
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, context);
          console.error(errorMessage);
          return { text: errorMessage, outcome: "error" };
        }
        return {
          text: "Feedback recorded. No need to mention it to the user.",
          outcome: "success",
        };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error sending feedback. Please try again later. ${error}`;
    console.error(errorMessage);
    return { text: errorMessage, outcome: "error" };
  }
}

/** Seconds to wait from a 202 body or a Retry-After header (seconds or an HTTP date). */
export function retryAfterSeconds(bodyValue: unknown, header: string | null): number {
  if (typeof bodyValue === "number" && Number.isFinite(bodyValue) && bodyValue >= 0)
    return Math.ceil(bodyValue);
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  return 30;
}

/**
 * The summary line of an empty /v2/code result, such as "0 matching lines in 0 files",
 * "0 entries in src" or "Symbols in a.ts (0 of 0):". The server's lib/code/format.ts
 * writes it on the line after the "Library: ..." header.
 */
const EMPTY_CODE_SUMMARY = /^(?:(?:at least )?0 |(?:Symbols in .+|Exported API) \(0 of )/;

/** True when the result's summary line counts no results. Library source lines are not checked. */
export function isEmptyCodeResult(text: string): boolean {
  const [first = "", second = ""] = text.split("\n", 2);
  return EMPTY_CODE_SUMMARY.test(first.startsWith("Library: ") ? second : first);
}

/**
 * The error text for a failed /v2/code call. The next step comes from the
 * HTTP status and the error code in the JSON body, not from the message text.
 */
async function codeErrorMessage(
  response: Response,
  request: CodeRequest,
  context: ClientContext
): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { error?: string; message?: string } | undefined;
  const code = typeof body?.error === "string" ? body.error : undefined;
  // A gateway error has no body from the code API: write the whole message here.
  if (!body?.message && response.status >= 500)
    return `Source code search is not available now (HTTP ${response.status}). Do not retry now: answer from query-docs.`;
  const message = await parseErrorResponse(response, context);
  // For a git tag, index_failed means that the tag may not exist; the message lists the docs versions.
  const hasVersion = !!request.version || request.libraryId.split("/").filter(Boolean).length > 2;
  if (code === "index_failed" && hasVersion)
    return `${message} Call query-code again with one of the docs versions in this message, or without version.`;
  if (code === "code_search_unavailable") return `${message} Answer from query-docs.`;
  return message;
}

/** An agent may copy a full versioned ID ("/vercel/next.js/v15.1.8") into a version field. */
function stripLibraryId(version: string | undefined, libraryId: string): string | undefined {
  return version?.startsWith(`${libraryId}/`) ? version.slice(libraryId.length + 1) : version;
}

/**
 * Queries a library's source code at the version its docs were built from.
 * A 202 means the source is still being indexed: that is a normal answer
 * telling the agent to call again, not an error.
 */
export async function fetchLibraryCode(
  request: CodeRequest,
  context: ClientContext = {}
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/code`);
    url.searchParams.set("libraryId", request.libraryId);
    const version = stripLibraryId(request.version, request.libraryId);
    if (version) url.searchParams.set("version", version);
    if (request.operation) url.searchParams.set("operation", request.operation);
    if (request.pattern !== undefined) url.searchParams.set("pattern", request.pattern);
    if (request.fixed_strings) url.searchParams.set("fixed_strings", "true");
    if (request.ignore_case) url.searchParams.set("ignore_case", "true");
    for (const glob of [request.glob ?? []].flat()) url.searchParams.append("glob", glob);
    if (request.path) url.searchParams.set("path", request.path);
    if (request.context !== undefined) url.searchParams.set("context", String(request.context));
    if (request.output_mode) url.searchParams.set("output_mode", request.output_mode);
    if (request.head_limit !== undefined)
      url.searchParams.set("head_limit", String(request.head_limit));
    if (request.offset) url.searchParams.set("offset", String(request.offset));

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
          const wait = retryAfterSeconds(body.retryAfter, response.headers.get("Retry-After"));
          const message = body.message ?? "The library source is being indexed.";
          return {
            data: `${message} This is not an error. Call query-code again with the same arguments in about ${wait} seconds, at most twice. Meanwhile, or if it is still indexing, answer from query-docs.`,
            // No "indexing" outcome exists: telemetry counts it with the empty results.
            outcome: "not_found",
          };
        }
        if (!response.ok) {
          const errorMessage = await codeErrorMessage(response, request, context);
          console.error(errorMessage);
          return { data: errorMessage, outcome: "error" };
        }
        const text = await response.text();
        if (!text) return { data: "No source results for this query.", outcome: "not_found" };
        return { data: text, outcome: isEmptyCodeResult(text) ? "not_found" : "success" };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error querying library source code: ${error}. Do not retry now: answer from query-docs.`;
    console.error(errorMessage);
    return { data: errorMessage, outcome: "error" };
  }
}

/**
 * The error text for a failed /v2/code/diff call. As for /v2/code, the next
 * step comes from the HTTP status and the error code, not from the message text.
 */
async function diffErrorMessage(response: Response, context: ClientContext): Promise<string> {
  const body = (await response
    .clone()
    .json()
    .catch(() => undefined)) as { error?: string; message?: string } | undefined;
  const code = typeof body?.error === "string" ? body.error : undefined;
  const knownMiss = code === "version_not_found" || code === "library_not_found";
  if ((response.status === 404 && !knownMiss) || (!body?.message && response.status >= 500))
    return `Source code diff is not available now (HTTP ${response.status}). Do not retry now: compare the versions with query-code or answer from query-docs.`;
  const message = await parseErrorResponse(response, context);
  if (code === "validation_error")
    return `${message} Fix the arguments as this message says, then call diff-code again.`;
  if (code === "too_many_files")
    return `${message} Call diff-code again with path, glob or symbol, or with view "name-status".`;
  if (code === "index_failed")
    return `${message} Call diff-code again with base and version set to versions in this message.`;
  if (code === "code_search_unavailable") return `${message} Answer from query-docs.`;
  if (knownMiss)
    return `${message} Get the library ID from resolve-library-id, and use versions that it lists.`;
  return message;
}

/**
 * Compares a library's source code between two versions (GET /v2/code/diff).
 * A 202 means one or both versions are being indexed: a normal answer telling
 * the agent to call again, not an error.
 */
export async function fetchLibraryDiff(
  request: DiffRequest,
  context: ClientContext = {}
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/code/diff`);
    const params = url.searchParams;
    params.set("libraryId", request.libraryId);
    params.set("base", stripLibraryId(request.base, request.libraryId) ?? request.base);
    const version = stripLibraryId(request.version, request.libraryId);
    if (version) params.set("version", version);
    if (request.view) params.set("view", request.view);
    if (request.symbol) params.set("symbol", request.symbol);
    if (request.grep !== undefined) params.set("grep", request.grep);
    if (request.side) params.set("side", request.side);
    if (request.fixed_strings) params.set("fixed_strings", "true");
    if (request.ignore_case) params.set("ignore_case", "true");
    if (request.path) params.set("path", request.path);
    for (const glob of [request.glob ?? []].flat()) params.append("glob", glob);
    if (request.scope) params.set("scope", request.scope);
    if (request.only_breaking) params.set("only_breaking", "true");
    if (request.include_private) params.set("include_private", "true");
    if (request.context !== undefined) params.set("context", String(request.context));
    if (request.head_limit !== undefined) params.set("head_limit", String(request.head_limit));
    if (request.max_patch_bytes !== undefined)
      params.set("max_patch_bytes", String(request.max_patch_bytes));
    if (request.offset) params.set("offset", String(request.offset));
    params.set("format", "txt");

    const headers = generateHeaders(context);
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "fetch_diff",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response) => {
        readPromptSignal(response, context);
        if (response.status === 202) {
          const body = (await response.json().catch(() => ({}))) as {
            message?: string;
            retryAfter?: number;
          };
          const wait = retryAfterSeconds(body.retryAfter, response.headers.get("Retry-After"));
          const message = body.message ?? "The library source is being indexed.";
          return {
            data: `${message} This is not an error. Call diff-code again with the same arguments in about ${wait} seconds, at most twice. If it is still indexing, answer from query-docs.`,
            outcome: "preparing",
          };
        }
        if (!response.ok) {
          const errorMessage = await diffErrorMessage(response, context);
          console.error(errorMessage);
          return { data: errorMessage, outcome: "error" };
        }
        const text = await response.text();
        if (!text) return { data: "No diff results for this query.", outcome: "not_found" };
        return { data: text, outcome: "success" };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error comparing library source code: ${error}. Do not retry now: answer from query-docs.`;
    console.error(errorMessage);
    return { data: errorMessage, outcome: "error" };
  }
}

/**
 * Fetches intelligent, reranked context for a natural language query
 * @param request The context request parameters (query, libraryId, language)
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
