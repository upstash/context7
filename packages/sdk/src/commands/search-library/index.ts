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

    const { type = DEFAULT_TYPE, ...requestOptions } = options ?? {};

    super(
      {
        method: "GET",
        query: { query, libraryName },
        ...requestOptions,
      },
      "v2/libs/search"
    );

    this.responseType = type;
  }

  public override async exec(client: Requester): Promise<Library[] | string> {
    const libraries = await this.findLibraries(client);

    if (this.responseType === "txt") {
      return formatLibrariesAsText(libraries);
    }

    return libraries;
  }

  private async findLibraries(client: Requester): Promise<Library[]> {
    try {
      const result = await this.requestResult<ApiSearchResponse>(client);
      return result.results.map(formatLibrary);
    } catch (error) {
      // The API answers 404 when nothing matches. A search with no hits is an
      // empty result, not a failure.
      if (error instanceof Context7Error && error.status === 404) return [];
      throw error;
    }
  }
}
