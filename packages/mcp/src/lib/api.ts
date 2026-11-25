import {
  SearchResponse,
  ContextRequest,
  ContextResponse,
  ClientContext,
  CodeRequest,
} from "./types.js";
import type { DocsFeedback, UpgradeGuideRequest } from "./experimental-tools.js";
import {
  experimentalToolsFromChoice,
  GET_UPGRADE_GUIDE_TOOL,
  type CodeTool,
  type ExperimentalTool,
  type ToolCallOutcome,
} from "./tool-names.js";
import { createHash } from "node:crypto";
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

/** What an experimental tool shows the agent, and the outcome its telemetry records. */
export type ToolAnswer = { text: string; outcome: ToolCallOutcome };

/** The response body as JSON, or undefined when it is not JSON. */
async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * Parses error response from the Context7 API
 * Extracts the server's error message, falling back to status-based messages if parsing fails
 * @param response The fetch Response object
 * @param context Client context (transport and credential shape pick the message)
 * @returns Error message string
 */
async function parseErrorResponse(response: Response, context: ClientContext): Promise<string> {
  const { apiKey } = context;
  const json = await readJson<{ error?: string; message?: string }>(response);

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
): Promise<ToolAnswer> {
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

/**
 * Seconds a code tool request lets the API wait for an index before it answers "being indexed".
 * The API would otherwise hold it up to 40 s; the agent goes on with query-docs instead.
 */
export const CODE_INDEX_WAIT_SECONDS = 5;

/** A sentence of the server's 202 message that tells the agent to wait and call again. */
const WAIT_ADVICE = /\b(call again|keep calling|meanwhile)\b/i;

/** The server's 202 message without its advice to call again. */
export function indexingMessage(message: string | undefined): string {
  return (message ?? "The library source is being indexed.")
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !WAIT_ADVICE.test(sentence))
    .join(" ");
}

/**
 * The answer while a library's source is being indexed. The code tools never make the agent
 * wait: an index can take minutes, or stall, and the user's session must go on. So the server's
 * own "keep calling" advice is dropped, and the agent answers from query-docs now.
 */
export function indexingAnswer(message: string | undefined, tool: string): string {
  const base = indexingMessage(message);
  return `${base} This is not an error. Until the index is done, every code tool call for this version gives this answer, so do not try other patterns or files and do not wait: answer from query-docs now. Only if the source is still needed at the end of the task, call ${tool} once more.`;
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
  context: ClientContext,
  tool: CodeTool
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
    return `${message} Call ${tool} again with one of the docs versions in this message, or without version.`;
  if (code === "code_search_unavailable") return `${message} Answer from query-docs.`;
  return message;
}

/**
 * Queries a library's source code at the version its docs were built from.
 * A 202 means the source is still being indexed: that is a normal answer, and the agent goes on
 * without it (see indexingAnswer).
 */
export async function fetchLibraryCode(
  request: CodeRequest,
  context: ClientContext,
  tool: CodeTool
): Promise<ContextResponse> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/code`);
    url.searchParams.set("libraryId", request.libraryId);
    // An agent may copy a full versioned ID ("/vercel/next.js/v15.1.8") into version.
    const version = request.version?.startsWith(`${request.libraryId}/`)
      ? request.version.slice(request.libraryId.length + 1)
      : request.version;
    if (version) url.searchParams.set("version", version);
    if (request.operation) url.searchParams.set("operation", request.operation);
    if (request.pattern !== undefined) url.searchParams.set("pattern", request.pattern);
    if (request.fixed_strings) url.searchParams.set("fixed_strings", "true");
    if (request.ignore_case) url.searchParams.set("ignore_case", "true");
    for (const glob of [request.glob ?? []].flat()) url.searchParams.append("glob", glob);
    if (request.path) url.searchParams.set("path", request.path);
    if (request.context !== undefined) url.searchParams.set("context", String(request.context));
    if (request.before_context !== undefined)
      url.searchParams.set("before_context", String(request.before_context));
    if (request.after_context !== undefined)
      url.searchParams.set("after_context", String(request.after_context));
    if (request.word_regexp) url.searchParams.set("word_regexp", "true");
    if (request.multiline) url.searchParams.set("multiline", "true");
    if (request.multiline_dotall) url.searchParams.set("multiline_dotall", "true");
    if (request.output_mode) url.searchParams.set("output_mode", request.output_mode);
    if (request.head_limit !== undefined)
      url.searchParams.set("head_limit", String(request.head_limit));
    if (request.offset) url.searchParams.set("offset", String(request.offset));
    url.searchParams.set("wait", String(CODE_INDEX_WAIT_SECONDS));

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
          return {
            data: indexingAnswer(body.message, tool),
            // No "indexing" outcome exists: telemetry counts it with the empty results.
            outcome: "not_found",
            indexing: {
              retryAfter: typeof body.retryAfter === "number" ? body.retryAfter : undefined,
              message: indexingMessage(body.message),
            },
          };
        }
        if (!response.ok) {
          const errorMessage = await codeErrorMessage(response, request, context, tool);
          console.error(errorMessage);
          // A 503 says the index will not come; other 5xx answers can pass.
          const transient = response.status >= 500 && response.status !== 503;
          return { data: errorMessage, outcome: "error", ...(transient && { transient }) };
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
    return { data: errorMessage, outcome: "error", transient: true };
  }
}

/**
 * The endpoint's error codes that answer the agent's request, not failures, with their telemetry
 * outcome: a library without a guide or an unknown version (not found), a page past the last
 * (invalid), or a guide that cannot be prepared for now (unavailable). The agent sees the API's
 * message, which says what to do next, without `isError`.
 */
const UPGRADE_GUIDE_ANSWERS = {
  library_not_prepared: "not_found",
  version_not_found: "not_found",
  page_out_of_range: "invalid",
  guide_unavailable: "unavailable",
} as const satisfies Record<string, ToolCallOutcome>;

function isUpgradeGuideAnswer(error: string): error is keyof typeof UPGRADE_GUIDE_ANSWERS {
  return Object.hasOwn(UPGRADE_GUIDE_ANSWERS, error);
}

/**
 * The tool's answer to an error response of the upgrade guide endpoint that answers the request
 * (UPGRADE_GUIDE_ANSWERS), or undefined for any other error. The text is the API's message,
 * which says what to do next and, for a guide unavailable for now, when to ask again.
 */
export function upgradeGuideAnswer(
  json: { error?: string; message?: string } | undefined
): ToolAnswer | undefined {
  const error = json?.error;
  if (!error || !isUpgradeGuideAnswer(error)) return undefined;
  return { text: json.message ?? error, outcome: UPGRADE_GUIDE_ANSWERS[error] };
}

/**
 * Fetches the upgrade guide for a library between two versions
 * @param request The library ID, the versions to upgrade from and to, and the page of the guide
 * @param context Client context including IP, API key, and client info
 * @returns The guide, a note to call again while it is prepared, or an error
 */
export async function fetchUpgradeGuide(
  request: UpgradeGuideRequest,
  context: ClientContext = {}
): Promise<ToolAnswer> {
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/version-upgrade-guide`);
    url.searchParams.set("libraryId", request.libraryId);
    url.searchParams.set("fromVersion", request.fromVersion);
    if (request.toVersion) url.searchParams.set("toVersion", request.toVersion);
    // Always sent, so the app can tell a client that pages from one that predates paging
    // (CTX7-3607). The app reads `page` from the deploy that ships paging: deploy it first.
    url.searchParams.set("page", String(request.page ?? 1));

    const headers = generateHeaders(context);
    const abortSignal = AbortSignal.timeout(API_TIMEOUT_MS);

    return await observeUpstreamRequest(
      "fetch_upgrade_guide",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response): Promise<ToolAnswer> => {
        // Checked for any status, before the status-specific fallbacks below; cloned so
        // parseErrorResponse can still read the body of any other error.
        if (!response.ok) {
          const json = await readJson<{ error?: string; message?: string }>(response.clone());
          const answer = upgradeGuideAnswer(json);
          if (answer) return answer;
        }
        switch (response.status) {
          // The source code is being indexed or the guide is being prepared; the agent calls again later.
          case 202: {
            const json = await readJson<{ retryAfter?: number; message?: string }>(response);
            const retryAfter =
              typeof json?.retryAfter === "number" && json.retryAfter > 0 ? json.retryAfter : 60;
            const note = `The upgrade guide is being prepared. Call '${GET_UPGRADE_GUIDE_TOOL}' again with the same arguments after ${retryAfter} seconds.`;
            return {
              text: json?.message ? `${note}\n\n${json.message}` : note,
              outcome: "success",
            };
          }
          case 404: {
            // Any other 404 (for example a deployment without the endpoint) is an upstream error.
            const text =
              "The upgrade guide service is not available (HTTP 404). Please try again later.";
            console.error(text);
            return { text, outcome: "error" };
          }
        }
        if (!response.ok) {
          const errorMessage = await parseErrorResponse(response, context);
          console.error(errorMessage);
          return { text: errorMessage, outcome: "error" };
        }
        const text = await response.text();
        if (!text) {
          return {
            text: "No upgrade guide was returned for these versions.",
            outcome: "not_found",
          };
        }
        return { text, outcome: "success" };
      },
      { abortSignal }
    );
  } catch (error) {
    const errorMessage = `Error fetching the upgrade guide. Please try again later. ${error}`;
    console.error(errorMessage);
    return { text: errorMessage, outcome: "error" };
  }
}

/**
 * Fetches intelligent, reranked context for a natural language query
 * @param request The context request parameters (query, libraryId, language, version)
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
    if (request.version) url.searchParams.set("version", request.version);

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

/** Ceiling on the settings call: it runs before a request is served, so it must stay short. */
const EXPERIMENTAL_TOOLS_TIMEOUT_MS = 2_000;
/**
 * How long a credential's choice is reused. A dashboard change shows within this time; it matches
 * the private cache hint of tools/list. 4.7.1 used 60 s and asked on every request, which
 * overloaded the app's key validation in production (CTX7-3866).
 */
const EXPERIMENTAL_TOOLS_TTL_MS = 5 * 60_000;
/** After a failed lookup the last known choice (or none) is kept this long before asking again. */
const EXPERIMENTAL_TOOLS_FAILURE_TTL_MS = 2 * 60_000;
const EXPERIMENTAL_TOOLS_CACHE_LIMIT = 10_000;
/**
 * Lookups one process runs at a time. Past it a request is served from the cache (or with none)
 * instead of adding to the load on a slow app.
 */
const EXPERIMENTAL_TOOLS_MAX_IN_FLIGHT = 32;

type ExperimentalToolsEntry = { tools: ExperimentalTool[]; expiresAt: number };
type ExperimentalToolsResult = { tools: ExperimentalTool[]; failure?: string };

const experimentalToolsCache = new Map<string, ExperimentalToolsEntry>();
/** One lookup per credential at a time: parallel requests share it. */
const experimentalToolsInFlight = new Map<string, Promise<ExperimentalToolsResult>>();

function rememberExperimentalTools(cacheKey: string, tools: ExperimentalTool[], ttlMs: number) {
  experimentalToolsCache.delete(cacheKey);
  if (experimentalToolsCache.size >= EXPERIMENTAL_TOOLS_CACHE_LIMIT) {
    // Maps keep insertion order: drop the oldest entry.
    const oldest = experimentalToolsCache.keys().next().value;
    if (oldest !== undefined) experimentalToolsCache.delete(oldest);
  }
  experimentalToolsCache.set(cacheKey, { tools, expiresAt: Date.now() + ttlMs });
}

async function lookUpExperimentalTools(
  context: ClientContext,
  cacheKey: string
): Promise<ExperimentalToolsResult> {
  // On failure keep the last known choice, even an expired one, so an outage of the app does
  // not take tools away from a session; only a credential never read lists none.
  const fail = (failure: string): ExperimentalToolsResult => {
    const tools = experimentalToolsCache.get(cacheKey)?.tools ?? [];
    rememberExperimentalTools(cacheKey, tools, EXPERIMENTAL_TOOLS_FAILURE_TTL_MS);
    return { tools, failure };
  };
  try {
    const url = new URL(`${CONTEXT7_API_BASE_URL}/v2/mcp/experimental-tools`);
    // No experimental header here: this call decides whether there are any.
    const headers = generateHeaders({ ...context, experimentalTools: undefined });
    const abortSignal = AbortSignal.timeout(EXPERIMENTAL_TOOLS_TIMEOUT_MS);
    return await observeUpstreamRequest(
      "fetch_experimental_tools",
      () => fetch(url, { headers, signal: abortSignal }),
      async (response) => {
        if (!response.ok) {
          const json = await readJson<{ error?: string }>(response);
          // As parseErrorResponse: an expired sign-in gets the HTTP 401 challenge next request.
          if (
            response.status === 401 &&
            context.transport === "http" &&
            (isOpaqueOAuthToken(context.apiKey) || isClerkOAuthJwt(context.apiKey)) &&
            (json?.error === INVALID_OAUTH_TOKEN_ERROR_CODE || json?.error === undefined)
          ) {
            rememberInvalidOAuthToken(context.apiKey);
          }
          return fail(`the Context7 API answered HTTP ${response.status}`);
        }
        const tools = experimentalToolsFromChoice(await readJson<unknown>(response));
        rememberExperimentalTools(cacheKey, tools, EXPERIMENTAL_TOOLS_TTL_MS);
        return { tools };
      },
      { abortSignal }
    );
  } catch (error) {
    return fail(`the Context7 API could not be reached (${error})`);
  }
}

/**
 * The experimental tools the credential's user turned on in the dashboard
 * (`GET /v2/mcp/experimental-tools`), for the stdio server and an HTTP server without the
 * snapshot (`experimental-tools-snapshot.ts`). Without a credential none: the server then lists
 * only the stable tools. When the lookup fails, the last known choice (or none), and `onFailure`
 * gets the cause once per lookup. Cached per credential (a hash, never the token).
 */
export async function fetchExperimentalTools(
  context: ClientContext,
  onFailure: (cause: string) => void = (cause) =>
    console.error(`Error reading experimental tools: ${cause}`)
): Promise<ExperimentalTool[]> {
  const { apiKey } = context;
  if (!apiKey) return [];

  const cacheKey = createHash("sha256").update(apiKey).digest("hex");
  const cached = experimentalToolsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tools;

  let lookup = experimentalToolsInFlight.get(cacheKey);
  if (lookup) return (await lookup).tools;
  if (experimentalToolsInFlight.size >= EXPERIMENTAL_TOOLS_MAX_IN_FLIGHT) {
    return cached?.tools ?? [];
  }
  lookup = lookUpExperimentalTools(context, cacheKey).finally(() =>
    experimentalToolsInFlight.delete(cacheKey)
  );
  experimentalToolsInFlight.set(cacheKey, lookup);
  const { tools, failure } = await lookup;
  if (failure) onFailure(failure);
  return tools;
}
