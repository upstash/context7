import type { CacheSetting, Requester } from "@http";

export const _ENDPOINTS = ["v2/libs/search", "v2/context"];

export type EndpointVariants = (typeof _ENDPOINTS)[number];

export interface CommandRequest {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  timeout?: number | false;
  cache?: CacheSetting;
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
    const { result } = await client.request<TResult>({
      method: this.request.method || "POST",
      path: [this.endpoint],
      query: this.request.query,
      body: this.request.body,
      signal: this.request.signal,
      timeout: this.request.timeout,
      cache: this.request.cache,
    });

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    return result;
  }
}
