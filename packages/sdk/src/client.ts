import type {
  Context7Config,
  SearchLibraryOptions,
  SearchLibraryResponse,
  GetDocsOptions,
  CodeSnippetsResponse,
  InfoSnippetsResponse,
} from "@types";
import { Context7Error } from "@error";
import { DEFAULT_BASE_URL, API_KEY_PREFIX } from "./constants.js";
import { HttpClient } from "@http";
import { SearchLibraryCommand, GetDocsCommand } from "@commands/index";

export class Context7 {
  private apiKey: string;
  private httpClient: HttpClient;

  constructor(config: Context7Config = {}) {
    const apiKey = config.apiKey || process.env.CONTEXT7_API_KEY || process.env.API_KEY;

    if (!apiKey) {
      throw new Context7Error(
        "API key is required. Pass it in the config or set CONTEXT7_API_KEY or API_KEY environment variable."
      );
    }

    if (!apiKey.startsWith(API_KEY_PREFIX)) {
      console.warn(`API key should start with '${API_KEY_PREFIX}'`);
    }

    this.apiKey = apiKey;

    this.httpClient = new HttpClient({
      baseUrl: DEFAULT_BASE_URL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      retry: {
        retries: 5,
        backoff: (retryCount) => Math.exp(retryCount) * 50,
      },
      cache: "no-store",
    });
  }

  async searchLibrary(
    query: string,
    options?: SearchLibraryOptions
  ): Promise<SearchLibraryResponse> {
    const command = new SearchLibraryCommand(query, options);
    return await command.exec(this.httpClient);
  }

  async getDocs(
    libraryId: string,
    options: GetDocsOptions & { format: "json"; docType: "info" }
  ): Promise<InfoSnippetsResponse>;

  async getDocs(
    libraryId: string,
    options: GetDocsOptions & { format: "json"; docType?: "code" }
  ): Promise<CodeSnippetsResponse>;

  async getDocs(libraryId: string, options?: GetDocsOptions & { format?: "txt" }): Promise<string>;

  async getDocs(
    libraryId: string,
    options?: GetDocsOptions
  ): Promise<string | CodeSnippetsResponse | InfoSnippetsResponse> {
    const command = new GetDocsCommand(libraryId, options);
    return await command.exec(this.httpClient);
  }
}
