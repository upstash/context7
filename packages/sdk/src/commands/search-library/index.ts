import { Command } from "@commands/command";
import type { SearchLibraryOptions, SearchLibraryResponse } from "@commands/types";

export class SearchLibraryCommand extends Command<SearchLibraryResponse> {
  constructor(query: string, _options?: SearchLibraryOptions) {
    const queryParams: Record<string, string | number | undefined> = {};

    if (query) {
      queryParams.query = query;
    }

    super({ method: "GET", query: queryParams }, "v2/search");
  }
}
