import { Command } from "@commands/command";
import type { GetContextOptions, Documentation } from "@commands/types";
import type { ApiContextJsonResponse } from "./types";
import type { Requester } from "@http";
import { Context7Error } from "@error";
import { formatCodeSnippet, formatInfoSnippet } from "@utils/format";

const DEFAULT_TYPE = "json";

export class GetContextCommand extends Command<Documentation[] | string> {
  private readonly responseType: "json" | "txt";

  constructor(query: string, libraryId: string, options?: GetContextOptions) {
    const queryParams: Record<string, string | number | undefined> = {};

    queryParams.query = query;
    queryParams.libraryId = libraryId;

    const responseType = options?.type ?? DEFAULT_TYPE;
    queryParams.type = responseType;

    super({ method: "GET", query: queryParams }, "v2/context");

    this.responseType = responseType;
  }

  public override async exec(client: Requester): Promise<Documentation[] | string> {
    const { result } = await client.request<string | ApiContextJsonResponse>({
      method: this.request.method || "GET",
      path: [this.endpoint],
      query: this.request.query,
      body: this.request.body,
    });

    if (result === undefined) {
      throw new Context7Error("Request did not return a result");
    }

    if (this.responseType === "txt" && typeof result === "string") {
      return result;
    }

    const apiResult = result as ApiContextJsonResponse;
    const codeDocs = apiResult.codeSnippets.map(formatCodeSnippet);
    const infoDocs = apiResult.infoSnippets.map(formatInfoSnippet);

    return [...codeDocs, ...infoDocs];
  }
}
