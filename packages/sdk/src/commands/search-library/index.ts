import { Command } from "@commands/command";
import type { Library, SearchLibraryOptions } from "@commands/types";
import type { ApiSearchResponse } from "./types";
import type { Requester } from "@http";
import { Context7Error } from "@error";
import { formatLibrary, formatLibrariesAsText } from "@utils/format";

const DEFAULT_TYPE = "json";

export class SearchLibraryCommand extends Command<Library[] | string> {
  private readonly responseType: "json" | "txt";

  constructor(query: string, libraryName: string, options?: SearchLibraryOptions) {
    if (!query || !libraryName) {
      throw new Context7Error("query and libraryName are required");
    }

    const queryParams: Record<string, string | number | undefined> = {};

    queryParams.query = query;
    queryParams.libraryName = libraryName;

    super(
      {
        method: "GET",
        query: queryParams,
        signal: options?.signal,
        timeout: options?.timeout,
        cache: options?.cache,
      },
      "v2/libs/search"
    );

    this.responseType = options?.type ?? DEFAULT_TYPE;
  }

  public override async exec(client: Requester): Promise<Library[] | string> {
    const { result } = await client.request<ApiSearchResponse>({
      method: this.request.method || "GET",
      path: [this.endpoint],
      query: this.request.query,
      signal: this.request.signal,
      timeout: this.request.timeout,
      cache: this.request.cache,
    });

    if (result === undefined) {
      throw new Context7Error("Request did not return a result");
    }

    const libraries = result.results.map(formatLibrary);

    if (this.responseType === "txt") {
      return formatLibrariesAsText(libraries);
    }

    return libraries;
  }
}
