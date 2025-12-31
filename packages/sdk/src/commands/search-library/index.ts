import { Command } from "@commands/command";
import type { Library } from "@commands/types";
import type { ApiSearchResponse } from "./types";
import type { Requester } from "@http";
import { Context7Error } from "@error";
import { formatLibrary } from "@utils/format";

export class SearchLibraryCommand extends Command<Library[]> {
  constructor(query: string, libraryName: string) {
    if (!query || !libraryName) {
      throw new Context7Error("query and libraryName are required");
    }

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
      throw new Context7Error("Request did not return a result");
    }

    return result.results.map(formatLibrary);
  }
}
