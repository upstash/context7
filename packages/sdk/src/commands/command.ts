import type { Requester } from "@http";
import { Context7Error } from "@error";
import type { Dict } from "@commands/types";

export const _ENDPOINTS = ["search", "v1/docs", "v1/docs/info", "v1/docs/code"];

export type EndpointVariants = (typeof _ENDPOINTS)[number];

export class Command<TResult> {
  public readonly payload: Dict | unknown[];
  public readonly endpoint: EndpointVariants;

  constructor(command: Dict | unknown[], endpoint: EndpointVariants) {
    this.payload = command;
    this.endpoint = endpoint;
  }

  /**
   * Execute the command using a client.
   */
  public async exec(client: Requester): Promise<TResult> {
    const { result, error } = await client.request<TResult>({
      body: this.payload,
      path: [this.endpoint],
    });

    if (error) {
      throw new Context7Error(error);
    }

    if (result === undefined) {
      throw new TypeError("Request did not return a result");
    }

    return result;
  }
}
