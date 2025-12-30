import { Command } from "@commands/command";
import type {
  GetContextOptions,
  ContextJsonResponse,
  ContextTextResponse,
} from "@commands/types";
import type { Requester } from "@http";

const DEFAULT_TYPE = "txt";

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
    const { result } = await client.request<string | ContextJsonResponse>({
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

    return result as ContextJsonResponse;
  }
}
