import { Command } from "@commands/command";
import type { GetDocsOptions, CodeSnippetsResponse, InfoSnippetsResponse } from "@commands/types";

export class GetDocsCommand extends Command<string | CodeSnippetsResponse | InfoSnippetsResponse> {
  constructor(libraryId: string, options?: GetDocsOptions) {
    const cleaned = libraryId.startsWith("/") ? libraryId.slice(1) : libraryId;
    const parts = cleaned.split("/");

    if (parts.length < 2) {
      throw new Error(
        `Invalid library ID format: ${libraryId}. Expected format: /username/library or /username/library/version`
      );
    }

    const owner = parts[0];
    const repo = parts[1];
    const version = parts[2] || options?.version;

    const docType = options?.docType || "code";

    const pathParts = ["v2", "docs", docType, owner, repo];
    if (version) {
      pathParts.push(version);
    }

    const queryParams: Record<string, string | number | undefined> = {};

    if (options?.topic) {
      queryParams.topic = options.topic;
    }

    if (options?.format) {
      queryParams.type = options.format;
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
        path: pathParts,
        query: queryParams,
      },
      pathParts.slice(0, 3).join("/")
    );
  }
}
