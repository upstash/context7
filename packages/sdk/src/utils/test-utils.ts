import type { Requester } from "@http";

export function requesterWith(result: unknown): Requester {
  return {
    request: async <TResult>() => ({ result: result as TResult }),
  };
}
