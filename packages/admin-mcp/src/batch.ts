import { PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";

// Copied from packages/mcp/src/index.ts. A legacy (2025) batch that carries a
// request and its own `notifications/cancelled` makes the SDK wait for an
// answer that never comes, so the POST stream (and the Vercel invocation)
// stays open until timeout. Such pairs are removed before dispatch.

type JsonRpcId = string | number;

function jsonRpcRequestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as Record<string, unknown>;
  if (
    candidate.jsonrpc === "2.0" &&
    typeof candidate.method === "string" &&
    (typeof candidate.id === "string" || typeof candidate.id === "number")
  ) {
    return candidate.id;
  }
}

function cancellationRequestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as Record<string, unknown>;
  if (
    candidate.jsonrpc !== "2.0" ||
    candidate.method !== "notifications/cancelled" ||
    "id" in candidate ||
    !candidate.params ||
    typeof candidate.params !== "object"
  ) {
    return undefined;
  }
  const requestId = (candidate.params as Record<string, unknown>).requestId;
  if (typeof requestId === "string" || typeof requestId === "number") return requestId;
}

/** True for a 2026-07-28 message: its `params._meta` names a protocol version. */
function hasProtocolVersionClaim(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const params = (message as Record<string, unknown>).params;
  if (!params || typeof params !== "object") return false;
  const meta = (params as Record<string, unknown>)._meta;
  return !!meta && typeof meta === "object" && PROTOCOL_VERSION_META_KEY in meta;
}

export function filterBatchSelfCancellations(body: unknown): {
  body: unknown;
  removedSelfCancellation: boolean;
} {
  if (!Array.isArray(body)) return { body, removedSelfCancellation: false };
  // The SDK answers 400 to a batch with a 2026-07-28 element; leave it whole.
  if (body.some(hasProtocolVersionClaim)) return { body, removedSelfCancellation: false };

  const requestIds = new Set(body.map(jsonRpcRequestId).filter((id) => id !== undefined));
  const selfCancelledIds = new Set(
    body
      .map(cancellationRequestId)
      .filter((id): id is JsonRpcId => id !== undefined && requestIds.has(id))
  );
  if (selfCancelledIds.size === 0) return { body, removedSelfCancellation: false };

  return {
    body: body.filter((message) => {
      const requestId = jsonRpcRequestId(message);
      if (requestId !== undefined && selfCancelledIds.has(requestId)) return false;
      const cancelledId = cancellationRequestId(message);
      return cancelledId === undefined || !selfCancelledIds.has(cancelledId);
    }),
    removedSelfCancellation: true,
  };
}
