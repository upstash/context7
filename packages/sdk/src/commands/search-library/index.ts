import { Command } from "@commands/command";
import type { SearchLibraryOptions, SearchLibraryResponse } from "@types";

export class SearchLibraryCommand extends Command<SearchLibraryResponse> {
  constructor(query: string, options?: SearchLibraryOptions) {
    const payload: Record<string, unknown> = {
      query,
    };

    if (options?.limit !== undefined) {
      payload.limit = options.limit;
    }

    super(payload, "search");
  }
}
