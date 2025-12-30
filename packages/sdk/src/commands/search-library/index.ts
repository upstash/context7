import { Command } from "@commands/command";
import type { SearchLibraryResponse } from "@commands/types";

export class SearchLibraryCommand extends Command<SearchLibraryResponse> {
  constructor(query: string, libraryName: string) {
    const queryParams: Record<string, string | number | undefined> = {};

    queryParams.query = query;
    queryParams.libraryName = libraryName;

    super({ method: "GET", query: queryParams }, "v2/libs/search");
  }
}
