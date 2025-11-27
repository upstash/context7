import type {
  Context7Config,
  SearchLibraryResponse,
  GetDocsOptions,
  CodeDocsResponse,
  InfoDocsResponse,
  TextDocsResponse,
} from "@commands/types";
import { Context7Error } from "@error";
import { HttpClient } from "@http";
import { SearchLibraryCommand, GetDocsCommand } from "@commands/index";

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

  async searchLibrary(query: string): Promise<SearchLibraryResponse> {
    const command = new SearchLibraryCommand(query);
    return await command.exec(this.httpClient);
  }

  async getDocs(
    libraryId: string,
    options: GetDocsOptions & { format: "txt" }
  ): Promise<TextDocsResponse>;

  async getDocs(
    libraryId: string,
    options: GetDocsOptions & { format?: "json"; mode: "info" }
  ): Promise<InfoDocsResponse>;

  async getDocs(
    libraryId: string,
    options?: GetDocsOptions & { format?: "json"; mode?: "code" }
  ): Promise<CodeDocsResponse>;

  async getDocs(
    libraryId: string,
    options?: GetDocsOptions
  ): Promise<TextDocsResponse | CodeDocsResponse | InfoDocsResponse> {
    const command = new GetDocsCommand(libraryId, options);
    return await command.exec(this.httpClient);
  }
}
