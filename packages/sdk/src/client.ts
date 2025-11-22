import type {
  Context7Config,
  SearchLibraryOptions,
  SearchLibraryResponse,
  GetDocsOptions,
  DocsResponse,
  GetLibraryResponse,
} from "./types.js";
import { Context7Error } from "./error.js";
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, API_KEY_PREFIX } from "./constants.js";

export class Context7 {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private clientIp?: string;
  private encryptionKey?: string;

  constructor(config: Context7Config) {
    if (!config.apiKey) {
      throw new Context7Error("API key is required");
    }
    if (!config.apiKey.startsWith(API_KEY_PREFIX)) {
      console.warn(`API key should start with '${API_KEY_PREFIX}'`);
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.clientIp = config.clientIp;
    this.encryptionKey = config.encryptionKey;
  }

  async searchLibrary(
    query: string,
    options?: SearchLibraryOptions
  ): Promise<SearchLibraryResponse> {
    // TODO: Implement
  }

  async getDocs(libraryId: string, options?: GetDocsOptions): Promise<DocsResponse> {
    // TODO: Implement
  }

  async getLibrary(libraryId: string): Promise<GetLibraryResponse> {
    // TODO: Implement
  }
}
