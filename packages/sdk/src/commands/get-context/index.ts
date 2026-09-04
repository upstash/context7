import { Command } from "@commands/command";
import type { GetContextOptions, Documentation } from "@commands/types";
import type { ApiContextJsonResponse } from "./types";
import type { Requester } from "@http";
import { formatCodeSnippet, formatInfoSnippet } from "@utils/format";

const DEFAULT_TYPE = "json";

export class GetContextCommand extends Command<Documentation[] | string> {
  private readonly responseType: "json" | "txt";

  constructor(query: string, libraryId: string, options?: GetContextOptions) {
    const { type = DEFAULT_TYPE, ...requestOptions } = options ?? {};

    super(
      {
        method: "GET",
        query: { query, libraryId, type },
        ...requestOptions,
      },
      "v2/context"
    );

    this.responseType = type;
  }

  public override async exec(client: Requester): Promise<Documentation[] | string> {
    const result = await this.requestResult<string | ApiContextJsonResponse>(client);

    if (this.responseType === "txt" && typeof result === "string") {
      return result;
    }

    const apiResult = result as ApiContextJsonResponse;
    const codeDocs = apiResult.codeSnippets.map(formatCodeSnippet);
    const infoDocs = apiResult.infoSnippets.map(formatInfoSnippet);

    return [...codeDocs, ...infoDocs];
  }
}
