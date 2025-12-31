import { Command } from "@commands/command";
import type { GetContextOptions, Documentation } from "@commands/types";
import type { Requester } from "@http";

const DEFAULT_TYPE = "txt";

interface ApiCodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeList: { language: string; code: string }[];
  codeId: string;
  codeTokens?: number;
  pageTitle?: string;
}

interface ApiInfoSnippet {
  content: string;
  breadcrumb?: string;
  pageId: string;
  contentTokens?: number;
}

interface ApiContextJsonResponse {
  selectedLibrary: string;
  codeSnippets: ApiCodeSnippet[];
  infoSnippets: ApiInfoSnippet[];
}

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
      throw new TypeError("Request did not return a result");
    }

    if (this.responseType === "txt" && typeof result === "string") {
      return result;
    }

    const apiResult = result as ApiContextJsonResponse;

    const codeDocs: Documentation[] = apiResult.codeSnippets.map((snippet) => {
      const codeBlocks = snippet.codeList
        .map((c) => `\`\`\`${c.language}\n${c.code}\n\`\`\``)
        .join("\n\n");

      const content = snippet.codeDescription
        ? `${snippet.codeDescription}\n\n${codeBlocks}`
        : codeBlocks;

      return {
        title: snippet.codeTitle,
        content,
        source: snippet.codeId,
      };
    });

    const infoDocs: Documentation[] = apiResult.infoSnippets.map((snippet) => ({
      title: snippet.breadcrumb || "Documentation",
      content: snippet.content,
      source: snippet.pageId,
    }));

    return [...codeDocs, ...infoDocs];
  }
}
