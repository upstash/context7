/** A message of a JSON-RPC body as received, before the SDK validates it. */
export interface JsonRpcMessageInfo {
  method: string;
  params: Record<string, unknown> | undefined;
}

/** The first message of a JSON-RPC body (one message or a batch) whose method is in `methods`. */
export function findJsonRpcMessage(
  body: unknown,
  methods: readonly string[]
): JsonRpcMessageInfo | undefined {
  for (const message of Array.isArray(body) ? body : [body]) {
    if (typeof message !== "object" || message === null) continue;
    const { method, params } = message as { method?: unknown; params?: unknown };
    if (typeof method === "string" && methods.includes(method)) {
      return {
        method,
        params:
          typeof params === "object" && params !== null
            ? (params as Record<string, unknown>)
            : undefined,
      };
    }
  }
  return undefined;
}
