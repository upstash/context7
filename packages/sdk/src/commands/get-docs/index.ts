import { Command } from "@commands/command";
import type {
  GetDocsOptions,
  CodeSnippetsResponse,
  InfoSnippetsResponse,
  QueryParams,
} from "@commands/types";

const DEFAULT_DOC_TYPE = "code";

const DEFAULT_FORMAT = "json";
export class GetDocsCommand extends Command<string | CodeSnippetsResponse | InfoSnippetsResponse> {
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
    const docType = options?.docType || DEFAULT_DOC_TYPE;

    const endpointParts = ["v2", "docs", docType, owner, repo];
    if (version) {
      endpointParts.push(version);
    }
    const endpoint = endpointParts.join("/");

    const queryParams: QueryParams = {};

    if (options?.topic) {
      queryParams.topic = options.topic;
    }

    if (options?.format) {
      queryParams.type = options.format;
    } else {
      queryParams.type = DEFAULT_FORMAT;
    }

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
  }
}
