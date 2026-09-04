import { Context7Error } from "@error";
import type { Context7Request, Requester } from "@http";

export const _ENDPOINTS = ["v2/libs/search", "v2/context"];

export type EndpointVariants = (typeof _ENDPOINTS)[number];

export type CommandRequest = Omit<Context7Request, "path">;

export class Command<TResult> {
  public readonly request: CommandRequest;
  public readonly endpoint: EndpointVariants;

  constructor(request: CommandRequest, endpoint: EndpointVariants) {
    this.request = request;
    this.endpoint = endpoint;
  }

  /**
   * Execute the command using a client.
   */
  public async exec(client: Requester): Promise<TResult> {
    return this.requestResult<TResult>(client);
  }

  protected async requestResult<T>(client: Requester): Promise<T> {
    const { result } = await client.request<T>({ ...this.request, path: [this.endpoint] });

    if (result === undefined) {
      throw new Context7Error("Request did not return a result", {
        code: "invalid_response",
      });
    }

    return result;
  }
}
