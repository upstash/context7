import { Command } from "@commands/command";
import type { Library } from "@commands/types";
import type { Requester } from "@http";

interface ApiSearchResult {
  id: string;
  title: string;
  description: string;
  versions?: string[];
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  branch?: string;
  lastUpdateDate?: string;
  state?: string;
  totalTokens?: number;
  stars?: number;
}

interface ApiSearchResponse {
  results: ApiSearchResult[];
}

export class SearchLibraryCommand extends Command<Library[]> {
  constructor(query: string, libraryName: string) {
    const queryParams: Record<string, string | number | undefined> = {};

    queryParams.query = query;
    queryParams.libraryName = libraryName;

    super({ method: "GET", query: queryParams }, "v2/libs/search");
  }

  public override async exec(client: Requester): Promise<Library[]> {
    const { result } = await client.request<ApiSearchResponse>({
      method: this.request.method || "GET",
      path: [this.endpoint],
      query: this.request.query,
    });

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    return result.results.map((r) => ({
      id: r.id,
      name: r.title,
      description: r.description,
      totalSnippets: r.totalSnippets ?? 0,
      trustScore: r.trustScore ?? 0,
      benchmarkScore: r.benchmarkScore ?? 0,
      versions: r.versions,
    }));
  }
}
