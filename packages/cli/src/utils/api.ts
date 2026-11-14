import type { LibrarySearchResponse, LibrarySearchResult, ContextResponse } from "../types.js";
import { VERSION } from "../constants.js";

export const DEFAULT_CONTEXT7_BASE_URL = "https://context7.com";

let baseUrl = DEFAULT_CONTEXT7_BASE_URL;

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string): void {
  baseUrl = url;
}

function getAuthHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Context7-Source": "cli",
    "X-Context7-Client-IDE": "ctx7-cli",
    "X-Context7-Client-Version": VERSION,
    "X-Context7-Transport": "cli",
  };
  const apiKey = process.env.CONTEXT7_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  return headers;
}

/**
 * How long a call may take before the CLI gives up. `/api/v2/code` waits up to
 * 40 s on the server for a first index, so it gets more time than the others.
 */
export const REQUEST_TIMEOUT_MS = 60_000;
export const CODE_REQUEST_TIMEOUT_MS = 70_000;

/** Statuses whose Response cannot carry a body. */
const NO_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** fetch with a timeout, so a stalled connection ends with a clear error instead of hanging. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    // Read the body under the same timeout, so a body that stalls after the
    // headers also ends with the message below. Answers are small.
    const body = NO_BODY_STATUS.has(response.status) ? null : await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(
        `Context7 did not answer within ${Math.round(timeoutMs / 1000)} seconds. Check your connection and run the command again.`
      );
    }
    throw err;
  }
}

export async function resolveLibrary(
  libraryName: string,
  query?: string,
  accessToken?: string
): Promise<LibrarySearchResponse> {
  const params = new URLSearchParams({ libraryName });
  if (query) {
    params.set("query", query);
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v2/libs/search?${params}`, {
    headers: getAuthHeaders(accessToken),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    return {
      results: [],
      error: errorData.error || `HTTP error ${response.status}`,
      message: errorData.message,
    };
  }

  return (await response.json()) as LibrarySearchResponse;
}

export interface GetContextOptions {
  type?: "json" | "txt";
  language?: string;
  /** The version the user's project uses, as written there ("15.4.3", "^15.4.3", "14"). */
  version?: string;
}

export const CODE_OPERATIONS = [
  "grep",
  "definition",
  "references",
  "outline",
  "read",
  "list",
] as const;
export type CodeOperation = (typeof CODE_OPERATIONS)[number];

/**
 * Ranges of the numeric `ctx7 code` flags. The server rejects a number out of
 * its range with a 400, so the command clamps numbers into these ranges first.
 */
export const CODE_LIMITS = {
  context: { min: 0, max: 10 },
  headLimit: { min: 1, max: 500 },
  offset: { min: 0, max: 10_000 },
} as const;

/**
 * Libraries built from a Git repository have source that `ctx7 code` can search.
 * This is a client-side guess from the ID and the branch: the server decides
 * with sourceRepo() in its /api/v2/code route and answers 422 "no_source".
 * Keep the rule the same as hasSourceCode in packages/mcp/src/lib/utils.ts.
 */
export function hasSourceCode(result: Pick<LibrarySearchResult, "id" | "branch">): boolean {
  return !/^\/(websites|llmstxt)\//.test(result.id) && !result.branch?.startsWith("_");
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

/** ripgrep-style search options plus LSP-style operations, as sent to /api/v2/code. */
export interface CodeQueryOptions {
  /** A git tag, or a commit from a result header. A version suffix on the library ID also works. */
  version?: string;
  operation?: CodeOperation;
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  glob?: string[];
  path?: string;
  context?: number;
  outputMode?: "content" | "files_with_matches" | "count";
  headLimit?: number;
  offset?: number;
  json?: boolean;
}

/**
 * The answer of an endpoint that can ask the client to come back later: the text, a 202 while the
 * server prepares something (the source index, an upgrade guide), or an error.
 */
export type RetryableResult =
  | { kind: "result"; body: string }
  | { kind: "pending"; message: string; retryAfter: number }
  | { kind: "error"; error: string; message?: string };

/** GETs an endpoint that answers 202 while it prepares, and reads its answer as RetryableResult. */
async function fetchRetryableText(
  url: string,
  accessToken: string | undefined,
  pendingMessage: string,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<RetryableResult> {
  const response = await fetchWithTimeout(url, { headers: getAuthHeaders(accessToken) }, timeoutMs);
  if (response.status === 202) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      retryAfter?: number;
    };
    return {
      kind: "pending",
      message: body.message ?? pendingMessage,
      retryAfter: retryAfterSeconds(body.retryAfter, response.headers.get("Retry-After")),
    };
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    return {
      kind: "error",
      error: body.error || `HTTP error ${response.status}`,
      message: body.message,
    };
  }
  return { kind: "result", body: await response.text() };
}

/** Queries a library's source code through /api/v2/code. */
export async function getLibraryCode(
  libraryId: string,
  pattern: string | undefined,
  options: CodeQueryOptions = {},
  accessToken?: string
): Promise<RetryableResult> {
  const params = new URLSearchParams({ libraryId });
  if (options.version) params.set("version", options.version);
  if (pattern) params.set("pattern", pattern);
  if (options.operation) params.set("operation", options.operation);
  if (options.fixedStrings) params.set("fixed_strings", "true");
  if (options.ignoreCase) params.set("ignore_case", "true");
  for (const glob of options.glob ?? []) params.append("glob", glob);
  if (options.path) params.set("path", options.path);
  if (options.context !== undefined) params.set("context", String(options.context));
  if (options.outputMode) params.set("output_mode", options.outputMode);
  if (options.headLimit) params.set("head_limit", String(options.headLimit));
  if (options.offset) params.set("offset", String(options.offset));
  if (options.json) params.set("format", "json");
  return fetchRetryableText(
    `${baseUrl}/api/v2/code?${params}`,
    accessToken,
    "The library source is being indexed.",
    CODE_REQUEST_TIMEOUT_MS
  );
}

export interface UpgradeGuideOptions {
  /** The version to upgrade to. Without it, the latest major. */
  toVersion?: string;
  /** The page of a long guide, from 1. */
  page?: number;
  json?: boolean;
}

/** Fetches the upgrade guide between two versions of a library through /api/v2/version-upgrade-guide. */
export async function getUpgradeGuide(
  libraryId: string,
  fromVersion: string,
  options: UpgradeGuideOptions = {},
  accessToken?: string
): Promise<RetryableResult> {
  const params = new URLSearchParams({ libraryId, fromVersion });
  if (options.toVersion) params.set("toVersion", options.toVersion);
  // Always sent, so the app pages the guide for this client (as the MCP tool does).
  params.set("page", String(options.page ?? 1));
  if (options.json) params.set("type", "json");
  return fetchRetryableText(
    `${baseUrl}/api/v2/version-upgrade-guide?${params}`,
    accessToken,
    "The upgrade guide is being prepared."
  );
}

export async function getLibraryContext(
  libraryId: string,
  query: string,
  options?: GetContextOptions,
  accessToken?: string
): Promise<ContextResponse | string> {
  const params = new URLSearchParams({ libraryId, query });
  if (options?.type) {
    params.set("type", options.type);
  }
  if (options?.language) {
    params.set("language", options.language);
  }
  if (options?.version) {
    params.set("version", options.version);
  }
  const headers = getAuthHeaders(accessToken);
  const response = await fetchWithTimeout(`${baseUrl}/api/v2/context?${params}`, {
    headers,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      redirectUrl?: string;
    };

    if (response.status === 301 && errorData.redirectUrl) {
      return {
        codeSnippets: [],
        infoSnippets: [],
        error: errorData.error || "library_redirected",
        message: errorData.message,
        redirectUrl: errorData.redirectUrl,
      };
    }

    return {
      codeSnippets: [],
      infoSnippets: [],
      error: errorData.error || `HTTP error ${response.status}`,
      message: errorData.message,
    };
  }

  if (options?.type === "txt") {
    return await response.text();
  }

  return (await response.json()) as ContextResponse;
}

export interface SearchDocumentationOptions {
  type: "json" | "txt";
  libraries?: string[];
  version?: string;
  language?: string;
}

export async function searchDocumentation(
  query: string,
  options: SearchDocumentationOptions,
  accessToken?: string
): Promise<unknown> {
  const params = new URLSearchParams({ query, type: options.type });
  for (const library of options.libraries ?? []) {
    params.append("library", library);
  }
  if (options.version) {
    params.set("version", options.version);
  }
  if (options.language) {
    params.set("language", options.language);
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v3/search?${params}`, {
    headers: getAuthHeaders(accessToken),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(errorData.message || errorData.error || `HTTP error ${response.status}`);
  }

  return options.type === "txt" ? response.text() : response.json();
}
