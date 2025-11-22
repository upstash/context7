import type {
  Context7Config,
  SearchLibraryOptions,
  SearchLibraryResponse,
  GetDocsOptions,
  DocsResponse,
} from "@types";
import { Context7Error } from "@error";
import { DEFAULT_BASE_URL, API_KEY_PREFIX } from "./constants.js";
import { HttpClient } from "@http";
import { SearchLibraryCommand, GetDocsCommand } from "@commands/index";

export class Context7 {
  private apiKey: string;
  private baseUrl: string;
  private clientIp?: string;
  private httpClient: HttpClient;

  constructor(config: Context7Config) {
    if (!config.apiKey) {
      throw new Context7Error("API key is required");
    }
    if (!config.apiKey.startsWith(API_KEY_PREFIX)) {
      console.warn(`API key should start with '${API_KEY_PREFIX}'`);
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.clientIp = config.clientIp;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.clientIp) {
      headers["X-Client-IP"] = this.clientIp;
    }

    this.httpClient = new HttpClient({
      baseUrl: this.baseUrl,
      headers,
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

  async getDocs(libraryId: string, options?: GetDocsOptions): Promise<DocsResponse> {
    const command = new GetDocsCommand(libraryId, options);
    return await command.exec(this.httpClient);
  }
}
