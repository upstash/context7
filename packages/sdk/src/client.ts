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
export * from "@error";

export class Context7 {
  private httpClient: HttpClient;

  constructor(config: Context7Config = {}) {
    const apiKey = config.apiKey || process.env.CONTEXT7_API_KEY;

    if (!apiKey) {
      throw new Context7Error(
        "API key is required. Pass it in the config or set CONTEXT7_API_KEY environment variable."
      );
    }

    if (!apiKey.startsWith(API_KEY_PREFIX)) {
      console.warn(`API key should start with '${API_KEY_PREFIX}'`);
    }

    this.httpClient = new HttpClient({
      baseUrl: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      retry: {
        retries: 5,
        backoff: (retryCount) => Math.exp(retryCount) * 50,
      },
      cache: "no-store",
    });
  }

  /**
   * Search for libraries matching the given query as JSON (array of Library objects)
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options: SearchLibraryOptions & { type: "json" }
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
   * Search for libraries matching the given query (defaults to JSON)
   */
  async searchLibrary(
    query: string,
    libraryName: string,
    options?: SearchLibraryOptions
  ): Promise<Library[]>;

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
    return await command.exec(this.httpClient);
  }

  /**
   * Get documentation context for a library as JSON (array of documentation snippets)
   */
  async getContext(
    query: string,
    libraryId: string,
    options: GetContextOptions & { type: "json" }
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
   * Get documentation context for a library (defaults to JSON)
   */
  async getContext(
    query: string,
    libraryId: string,
    options?: GetContextOptions
  ): Promise<Documentation[]>;

  /**
   * Get documentation context for a library
   * @param query The user's question or task
   * @param libraryId Context7 library ID (e.g., "/facebook/react")
   * @param options Response format options
   * @returns Documentation as Documentation[] (json, default) or string (txt)
   */
  async getContext(
    query: string,
    libraryId: string,
    options?: GetContextOptions
  ): Promise<Documentation[] | string> {
    const command = new GetContextCommand(query, libraryId, options);
    return await command.exec(this.httpClient);
  }
}
