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
    const result = await this.requestResult<ApiSearchResponse>(client);

    const libraries = result.results.map(formatLibrary);

    if (this.responseType === "txt") {
      return formatLibrariesAsText(libraries);
    }

    return libraries;
  }
}
