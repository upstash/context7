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

export async function resolveLibrary(
  libraryName: string,
  query?: string,
  accessToken?: string
): Promise<LibrarySearchResponse> {
  const params = new URLSearchParams({ libraryName });
  if (query) {
    params.set("query", query);
  }

  const response = await fetch(`${baseUrl}/api/v2/libs/search?${params}`, {
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
  /** Seconds `ctx7 code` waits for a first index. Agents' shell tools often stop a command at 2 min. */
  wait: { min: 0, max: 600 },
} as const;

/** Default for `ctx7 code --wait`: a first index takes about 90 s at the median. */
export const CODE_WAIT_SECONDS = 90;
/** Pause between calls while an index is built. Each call itself waits for the index on the server. */
const CODE_WAIT_PAUSE_MS = 3_000;

/**
 * Runs `query` again while it answers "indexing", until `budgetMs` has passed.
 * The next call starts only when it can end inside the budget, judged by how
 * long the previous call took, so the command stays within the budget.
 */
export async function waitForLibraryCode(
  query: () => Promise<CodeQueryResult>,
  budgetMs: number,
  {
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    onWait,
  }: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    /** Called before each new wait with the "indexing" answer and the seconds left. */
    onWait?: (result: Extract<CodeQueryResult, { kind: "indexing" }>, secondsLeft: number) => void;
  } = {}
): Promise<CodeQueryResult> {
  const start = now();
  let callStart = start;
  let result = await query();
  while (result.kind === "indexing") {
    const callMs = now() - callStart;
    const left = budgetMs - (now() - start);
    if (left < CODE_WAIT_PAUSE_MS + callMs) break;
    onWait?.(result, Math.round(left / 1000));
    await sleep(CODE_WAIT_PAUSE_MS);
    callStart = now();
    result = await query();
  }
  return result;
}

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

export type CodeQueryResult =
  | { kind: "result"; body: string }
  | { kind: "indexing"; message: string; retryAfter: number }
  | { kind: "error"; error: string; message?: string };

/** Queries a library's source code through /api/v2/code. */
export async function getLibraryCode(
  libraryId: string,
  pattern: string | undefined,
  options: CodeQueryOptions = {},
  accessToken?: string
): Promise<CodeQueryResult> {
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
  const response = await fetch(`${baseUrl}/api/v2/code?${params}`, {
    headers: getAuthHeaders(accessToken),
  });
  if (response.status === 202) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
      retryAfter?: number;
    };
    return {
      kind: "indexing",
      message: body.message ?? "The library source is being indexed.",
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
  const headers = getAuthHeaders(accessToken);
  const response = await fetch(`${baseUrl}/api/v2/context?${params}`, {
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

  const response = await fetch(`${baseUrl}/api/v3/search?${params}`, {
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
