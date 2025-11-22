import { Command } from "@commands/command";
import type { GetDocsOptions, DocsResponse } from "@types";

export class GetDocsCommand extends Command<DocsResponse> {
  constructor(libraryId: string, options?: GetDocsOptions) {
    const cleaned = libraryId.startsWith("/") ? libraryId.slice(1) : libraryId;
    const parts = cleaned.split("/");

    if (parts.length < 2) {
      throw new Error(
        `Invalid library ID format: ${libraryId}. Expected format: /username/library or /username/library/version`
      );
    }

    const username = parts[0];
    const library = parts[1];
    const version = parts[2];

    const endpoint = options?.type === "info" ? "v1/docs/info" : "v1/docs/code";

    const payload: Record<string, unknown> = {
      username,
      library,
    };

    if (version) {
      payload.version = version;
    }

    if (options?.page !== undefined) {
      payload.page = options.page;
    }

    if (options?.topic) {
      payload.topic = options.topic;
    }

    if (options?.limit !== undefined) {
      payload.limit = options.limit;
    }

    super(payload, endpoint);
  }
}
