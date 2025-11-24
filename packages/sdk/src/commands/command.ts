import type { Requester, Context7Request } from "@http";
import { Context7Error } from "@error";

export const _ENDPOINTS = ["v2/search", "v2/docs/info", "v2/docs/code"];

export type EndpointVariants = (typeof _ENDPOINTS)[number];

export interface CommandRequest {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  path?: string[];
}

export class Command<TResult> {
  public readonly request: CommandRequest;
  public readonly endpoint: EndpointVariants;

  constructor(request: CommandRequest, endpoint: EndpointVariants | string) {
    this.request = request;
    this.endpoint = endpoint;
  }

  /**
   * Execute the command using a client.
   */
  public async exec(client: Requester): Promise<TResult> {
    const contextRequest: Context7Request = {
      method: this.request.method || "POST",
      path: this.request.path || [this.endpoint],
      query: this.request.query,
      body: this.request.body,
    };

    const { result, error } = await client.request<TResult>(contextRequest);

    if (error) {
      throw new Context7Error(error);
    }

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    return result;
  }
}
