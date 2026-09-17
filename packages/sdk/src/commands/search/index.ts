import { Command } from "@commands/command";
import type { SearchOptions, SearchResponse } from "@commands/types";

const DEFAULT_TYPE = "json";

export class SearchCommand extends Command<SearchResponse | string> {
  constructor(query: string, options?: SearchOptions) {
    const { type = DEFAULT_TYPE, libraries, version, language, ...requestOptions } = options ?? {};

    super(
      {
        method: "GET",
        query: { query, type, library: libraries, version, language },
        ...requestOptions,
      },
      "v2/search"
    );
  }
}
