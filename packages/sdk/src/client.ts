import type {
  Context7Config,
  GetContextOptions,
  SearchLibraryOptions,
  Library,
  Documentation,
} from "@commands/types";
import { Context7Error } from "@error";
import { HttpClient } from "@http";
import { SearchLibraryCommand, GetContextCommand } from "@commands/index";

const DEFAULT_BASE_URL = "https://context7.com/api";
const API_KEY_PREFIX = "ctx7sk";

export type * from "@commands/types";
export type {
  CacheSetting,
  Context7Fetch,
  Context7ResponseMetadata,
  RateLimitMetadata,
  RetryConfig,
} from "@http";
export * from "@error";

export class Context7 {
  private readonly httpClient: HttpClient;

  constructor(config: Context7Config = {}) {
    const apiKey = config.apiKey || getEnvironmentApiKey();

    if (!apiKey) {
      throw new Context7Error(
        "API key is required. Pass it in the config or set CONTEXT7_API_KEY environment variable."
      );
    }

    if (!apiKey.startsWith(API_KEY_PREFIX)) {
      console.warn(`API key should start with '${API_KEY_PREFIX}'`);
    }

    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      headers: {
        ...withoutAuthorizationHeader(config.headers),
        Authorization: `Bearer ${apiKey}`,
      },
      retry: config.retry,
      cache: config.cache ?? "no-store",
      timeout: config.timeout,
      signal: config.signal,
      keepAlive: config.keepAlive,
      fetch: config.fetch,
      onResponse: config.onResponse,
    });
  }

  /**
   * Search for libraries matching the given query as JSON (array of Library objects)
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options?: SearchLibraryOptions & { type?: "json" }
  ): Promise<Library[]>;

  /**
   * Search for libraries matching the given query as plain text
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options: SearchLibraryOptions & { type: "txt" }
  ): Promise<string>;

  /**
   * Search for libraries with options whose response type is determined at runtime
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options?: SearchLibraryOptions
  ): Promise<Library[] | string>;

  /**
   * Search for libraries matching the given query
   * @param query The user's question or task (used for relevance ranking)
   * @param libraryName The library name to search for
   * @param options Response format options
   * @returns Array of matching libraries (json) or formatted text (txt)
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options?: SearchLibraryOptions
  ): Promise<Library[] | string> {
    const command = new SearchLibraryCommand(query, libraryName, options);
    return command.exec(this.httpClient);
  }

  /**
   * Get documentation context for a library as JSON (array of documentation snippets)
   */
  async getContext(
    query: string,
    libraryId: string,
    options?: GetContextOptions & { type?: "json" }
  ): Promise<Documentation[]>;

  /**
   * Get documentation context for a library as plain text
   */
  async getContext(
    query: string,
    libraryId: string,
    options: GetContextOptions & { type: "txt" }
  ): Promise<string>;

  /**
   * Get documentation context with options whose response type is determined at runtime
   */
  async getContext(
    query: string,
    libraryId: string,
    options?: GetContextOptions
  ): Promise<Documentation[] | string>;

  /**
   * Get documentation context for a library
   * @param query The user's question or task
   * @param libraryId Context7 library ID (e.g., "/react/react")
   * @param options Response format options
   * @returns Documentation as Documentation[] (json, default) or string (txt)
   */
  async getContext(
    query: string,
    libraryId: string,
    options?: GetContextOptions
  ): Promise<Documentation[] | string> {
    const command = new GetContextCommand(query, libraryId, options);
    return command.exec(this.httpClient);
  }
}

function getEnvironmentApiKey(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env?.CONTEXT7_API_KEY;
}

function withoutAuthorizationHeader(headers?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization")
  );
}
