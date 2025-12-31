import { Command } from "@commands/command";
import type {
  GetContextOptions,
  ContextJsonResponse,
  ContextTextResponse,
  Documentation,
} from "@commands/types";
import type { Requester } from "@http";

const DEFAULT_TYPE = "txt";

/** Raw API code snippet */
interface ApiCodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeList: { language: string; code: string }[];
  // Internal fields we don't expose
  codeTokens?: number;
  codeId?: string;
  pageTitle?: string;
}

/** Raw API info snippet */
interface ApiInfoSnippet {
  content: string;
  breadcrumb?: string;
  // Internal fields we don't expose
  pageId?: string;
  contentTokens?: number;
}

/** Raw API JSON response */
interface ApiContextJsonResponse {
  selectedLibrary: string;
  codeSnippets: ApiCodeSnippet[];
  infoSnippets: ApiInfoSnippet[];
  rules?: string[];
}

export class GetContextCommand extends Command<ContextJsonResponse | ContextTextResponse> {
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

  public override async exec(
    client: Requester
  ): Promise<ContextJsonResponse | ContextTextResponse> {
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
      return { data: result } satisfies ContextTextResponse;
    }

    const apiResult = result as ApiContextJsonResponse;

    // Transform code snippets to Documentation
    const codeDocs: Documentation[] = apiResult.codeSnippets.map((snippet) => ({
      title: snippet.codeTitle,
      content: snippet.codeList.map((c) => c.code).join("\n\n"),
      language: snippet.codeLanguage,
    }));

    // Transform info snippets to Documentation
    const infoDocs: Documentation[] = apiResult.infoSnippets.map((snippet) => ({
      title: snippet.breadcrumb || "Documentation",
      content: snippet.content,
    }));

    return {
      library: apiResult.selectedLibrary,
      docs: [...codeDocs, ...infoDocs],
      rules: apiResult.rules,
    } satisfies ContextJsonResponse;
  }
}
