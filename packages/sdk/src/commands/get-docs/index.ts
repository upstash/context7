import { Command } from "@commands/command";
import type {
  GetDocsOptions,
  CodeDocsResponse,
  InfoDocsResponse,
  TextDocsResponse,
  QueryParams,
} from "@commands/types";
import type { Requester } from "@http";

const DEFAULT_DOC_TYPE = "code";
const DEFAULT_FORMAT = "json";

export class GetDocsCommand extends Command<
  TextDocsResponse | CodeDocsResponse | InfoDocsResponse
> {
  private readonly format: "json" | "txt";

  constructor(libraryId: string, options?: GetDocsOptions) {
    const cleaned = libraryId.startsWith("/") ? libraryId.slice(1) : libraryId;
    const parts = cleaned.split("/");

    if (parts.length !== 2) {
      throw new Error(
        `Invalid library ID format: ${libraryId}. Expected format: /username/library`
      );
    }

    const [owner, repo] = parts;

    const version = options?.version;
    const mode = options?.mode || DEFAULT_DOC_TYPE;

    const endpointParts = ["v2", "docs", mode, owner, repo];
    if (version) {
      endpointParts.push(version);
    }
    const endpoint = endpointParts.join("/");

    const queryParams: QueryParams = {};

    if (options?.topic) {
      queryParams.topic = options.topic;
    }

    const format = options?.format ?? DEFAULT_FORMAT;
    queryParams.type = format;

    if (options?.page !== undefined) {
      queryParams.page = options.page;
    }

    if (options?.limit !== undefined) {
      queryParams.limit = options.limit;
    }

    super(
      {
        method: "GET",
        query: queryParams,
      },
      endpoint
    );

    this.format = format;
  }

  public override async exec(
    client: Requester
  ): Promise<TextDocsResponse | CodeDocsResponse | InfoDocsResponse> {
    const { result, headers } = await client.request<string | CodeDocsResponse | InfoDocsResponse>({
      method: this.request.method || "POST",
      path: [this.endpoint],
      query: this.request.query,
      body: this.request.body,
    });

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    if (this.format === "txt" && typeof result === "string") {
      const defaultPagination = {
        page: 1,
        limit: 10,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      };

      return {
        content: result,
        pagination: {
          page: headers?.page ?? defaultPagination.page,
          limit: headers?.limit ?? defaultPagination.limit,
          totalPages: headers?.totalPages ?? defaultPagination.totalPages,
          hasNext: headers?.hasNext ?? defaultPagination.hasNext,
          hasPrev: headers?.hasPrev ?? defaultPagination.hasPrev,
        },
        totalTokens: headers?.totalTokens ?? 0,
      } satisfies TextDocsResponse;
    }

    return result as CodeDocsResponse | InfoDocsResponse;
  }
}
