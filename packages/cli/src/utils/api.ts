import type { LibrarySearchResponse, ContextResponse } from "../types.js";
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

/** ripgrep-style search options plus LSP-style operations, as sent to /api/v2/code. */
export interface CodeQueryOptions {
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
      retryAfter: body.retryAfter ?? Number(response.headers.get("Retry-After") ?? 30),
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
