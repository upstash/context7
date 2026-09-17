import { Command } from "@commands/command";
import type { SearchDocumentation, SearchOptions } from "@commands/types";
import type { Requester } from "@http";
import { formatCodeSnippet, formatInfoSnippet } from "@utils/format";
import type { ApiSearchJsonResponse } from "./types";

const DEFAULT_TYPE = "txt";

export class SearchCommand extends Command<SearchDocumentation[] | string> {
  private readonly responseType: "json" | "txt";

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

    this.responseType = type;
  }

  public override async exec(client: Requester): Promise<SearchDocumentation[] | string> {
    const result = await this.requestResult<string | ApiSearchJsonResponse>(client);

    if (this.responseType === "txt" && typeof result === "string") {
      return result;
    }

    const apiResult = result as ApiSearchJsonResponse;
    const codeDocs = apiResult.codeSnippets.map((snippet) => ({
      ...formatCodeSnippet(snippet),
      libraryId: snippet.libraryId,
    }));
    const infoDocs = apiResult.infoSnippets.map((snippet) => ({
      ...formatInfoSnippet(snippet),
      libraryId: snippet.libraryId,
    }));

    return [...codeDocs, ...infoDocs];
  }
}
