import { Command } from "@commands/command";
import type { SearchLibraryResponse, Library } from "@commands/types";
import type { Requester } from "@http";

/** Raw API response from v2/libs/search */
interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  versions?: string[];
  // Internal fields we don't expose
  branch?: string;
  lastUpdateDate?: string;
  state?: string;
  totalTokens?: number;
  totalSnippets?: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
}

interface ApiSearchResponse {
  results: ApiSearchResult[];
  error?: string;
}

export class SearchLibraryCommand extends Command<SearchLibraryResponse> {
  constructor(query: string, libraryName: string) {
    const queryParams: Record<string, string | number | undefined> = {};

    queryParams.query = query;
    queryParams.libraryName = libraryName;

    super({ method: "GET", query: queryParams }, "v2/libs/search");
  }

  public override async exec(client: Requester): Promise<SearchLibraryResponse> {
    const { result } = await client.request<ApiSearchResponse>({
      method: this.request.method || "GET",
      path: [this.endpoint],
      query: this.request.query,
    });

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    // Transform API response to simplified Library type
    const libraries: Library[] = result.results.map((r) => ({
      id: r.id,
      name: r.title,
      description: r.description,
      versions: r.versions,
    }));

    return {
      results: libraries,
      error: result.error,
    };
  }
}
