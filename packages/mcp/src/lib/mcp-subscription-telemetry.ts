import {
  classifyInboundRequest,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  SUBSCRIPTION_ID_META_KEY,
  type JSONRPCMessage,
  type McpHandlerRequestOptions,
  type McpHttpHandler,
  type MessageExtraInfo,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { metrics, type Attributes } from "@opentelemetry/api";

const INSTRUMENTATION_NAME = "io.github.upstash.context7.mcp";
const SUBSCRIPTION_DURATION_BUCKETS_SECONDS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];

export type McpRoute = "anonymous" | "oauth" | "stdio";
export type SubscriptionOutcome =
  | "cancelled"
  | "completed"
  | "connection_closed"
  | "replaced"
  | "transport_error";

export interface SubscriptionObservation {
  abortSignal?: AbortSignal;
  networkProtocol?: "http";
  networkTransport: "pipe" | "tcp";
  protocolVersion?: string;
  route: McpRoute;
}

export interface SubscriptionEntryOperation {
  applyResponse(response: JSONRPCMessage): void;
  fail(errorType: string, error?: unknown): void;
  finish(): void;
  run<T>(operation: () => T): T;
}

export type StartSubscriptionEntryOperation = (
  message: JSONRPCMessage,
  observation: SubscriptionObservation
) => SubscriptionEntryOperation;

function createInstruments() {
  const meter = metrics.getMeter(INSTRUMENTATION_NAME);
  return {
    activeSubscriptions: meter.createUpDownCounter("context7.mcp.subscriptions.active", {
      description: "Number of accepted MCP subscriptions currently open",
      unit: "{subscription}",
    }),
    subscriptionDuration: meter.createHistogram("context7.mcp.subscription.duration", {
      description: "Duration of an accepted MCP subscription",
      unit: "s",
      advice: { explicitBucketBoundaries: SUBSCRIPTION_DURATION_BUCKETS_SECONDS },
    }),
  };
}

let instruments: ReturnType<typeof createInstruments> | undefined;

function getInstruments(): ReturnType<typeof createInstruments> {
  instruments ??= createInstruments();
  return instruments;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function elapsedSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1_000;
}

export class SubscriptionLifecycle {
  private readonly abortSignal?: AbortSignal;
  private readonly metricAttributes: Attributes;
  private finished = false;
  private readonly startedAt = performance.now();

  constructor(
    observation: SubscriptionObservation,
    private readonly onFinish?: () => void
  ) {
    this.abortSignal = observation.abortSignal;
    this.metricAttributes = {
      "context7.mcp.route": observation.route,
      "network.transport": observation.networkTransport,
      ...(observation.protocolVersion
        ? { "mcp.protocol.version": observation.protocolVersion }
        : {}),
    };
    getInstruments().activeSubscriptions.add(1, this.metricAttributes);
    this.abortSignal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  private readonly handleAbort = (): void => {
    this.finish("cancelled");
  };

  finish(outcome: SubscriptionOutcome): void {
    if (this.finished) return;
    this.finished = true;
    this.abortSignal?.removeEventListener("abort", this.handleAbort);
    const { activeSubscriptions, subscriptionDuration } = getInstruments();
    activeSubscriptions.add(-1, this.metricAttributes);
    subscriptionDuration.record(elapsedSeconds(this.startedAt), {
      ...this.metricAttributes,
      "context7.mcp.subscription.outcome": outcome,
    });
    this.onFinish?.();
  }
}

export function subscriptionAcknowledgementId(message: JSONRPCMessage): RequestId | undefined {
  if (
    !isJSONRPCNotification(message) ||
    message.method !== "notifications/subscriptions/acknowledged"
  ) {
    return undefined;
  }
  const subscriptionId = asRecord(asRecord(message.params)?._meta)?.[SUBSCRIPTION_ID_META_KEY];
  return typeof subscriptionId === "string" || typeof subscriptionId === "number"
    ? subscriptionId
    : undefined;
}

export function completedSubscriptionId(message: JSONRPCMessage): RequestId | undefined {
  if (!isJSONRPCResultResponse(message)) return undefined;
  const result = asRecord(message.result);
  if (result?.resultType !== "complete") return undefined;
  const subscriptionId = asRecord(result._meta)?.[SUBSCRIPTION_ID_META_KEY];
  return typeof subscriptionId === "string" || typeof subscriptionId === "number"
    ? subscriptionId
    : undefined;
}

function cancellationRequestId(message: JSONRPCMessage): RequestId | undefined {
  if (!isJSONRPCNotification(message) || message.method !== "notifications/cancelled") {
    return undefined;
  }
  const requestId = asRecord(message.params)?.requestId;
  return typeof requestId === "string" || typeof requestId === "number" ? requestId : undefined;
}

interface ListenAttempt {
  cancelRequested: boolean;
  operation: SubscriptionEntryOperation;
  phase: "acknowledging" | "pending" | "rejecting";
}

interface StdioSubscription {
  acknowledgementWritePending: boolean;
  lifecycle: SubscriptionLifecycle;
  terminalWritePending: boolean;
}

interface StdioSubscriptionState {
  attempts: ListenAttempt[];
  subscription?: StdioSubscription;
}

/** Owns the entry-handled listen/cancel state that never reaches an MCP server transport. */
export class StdioSubscriptionTelemetry {
  private connectionClosed = false;
  private readonly states = new Map<RequestId, StdioSubscriptionState>();

  constructor(
    private readonly startOperation: StartSubscriptionEntryOperation,
    private readonly modernProtocolVersion: string
  ) {}

  receive(
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    handler: NonNullable<Transport["onmessage"]>,
    protocolVersion?: string
  ): boolean {
    const observation = this.observation(protocolVersion);
    if (
      protocolVersion === this.modernProtocolVersion &&
      isJSONRPCRequest(message) &&
      message.method === "subscriptions/listen"
    ) {
      const operation = this.startOperation(message, observation);
      const state = this.stateFor(message.id);
      const attempt: ListenAttempt = { cancelRequested: false, operation, phase: "pending" };
      state.attempts.push(attempt);
      try {
        operation.run(() => handler(message, extra));
      } catch (error) {
        operation.fail("handler_error", error);
        this.removeAttempt(message.id, state, attempt);
        throw error;
      }
      return true;
    }

    const cancelledId = cancellationRequestId(message);
    const state = cancelledId === undefined ? undefined : this.states.get(cancelledId);
    const pendingAttempt = state?.attempts.at(-1);
    const activeSubscription =
      state?.subscription !== undefined &&
      !state.subscription.acknowledgementWritePending &&
      !state.subscription.terminalWritePending;
    if (
      protocolVersion !== this.modernProtocolVersion ||
      cancelledId === undefined ||
      (!pendingAttempt && !activeSubscription)
    ) {
      return false;
    }

    const operation = this.startOperation(message, observation);
    try {
      operation.run(() => handler(message, extra));
      if (pendingAttempt) {
        pendingAttempt.cancelRequested = true;
      } else if (state?.subscription && activeSubscription) {
        state.subscription.lifecycle.finish("cancelled");
        state.subscription = undefined;
        this.prune(cancelledId, state);
      }
      operation.finish();
    } catch (error) {
      operation.fail("handler_error", error);
      throw error;
    }
    return true;
  }

  async send(
    message: JSONRPCMessage,
    options: TransportSendOptions | undefined,
    send: (message: JSONRPCMessage, options?: TransportSendOptions) => Promise<void>,
    protocolVersion?: string
  ): Promise<void> {
    const acknowledgementId = subscriptionAcknowledgementId(message);
    const rejectionId = isJSONRPCErrorResponse(message) ? message.id : undefined;
    const attemptId = acknowledgementId ?? rejectionId;
    const state = attemptId === undefined ? undefined : this.states.get(attemptId);
    const pendingAttempt = state?.attempts[0];
    const attempt = pendingAttempt?.phase === "pending" ? pendingAttempt : undefined;
    const completionId = completedSubscriptionId(message);
    const completionState = completionId === undefined ? undefined : this.states.get(completionId);
    const completing =
      completionState?.subscription && !completionState.subscription.terminalWritePending
        ? completionState.subscription
        : undefined;
    let acknowledged: StdioSubscription | undefined;

    if (attempt && acknowledgementId !== undefined && state) {
      state.subscription?.lifecycle.finish("replaced");
      acknowledged = {
        acknowledgementWritePending: true,
        lifecycle: new SubscriptionLifecycle(this.observation(protocolVersion)),
        terminalWritePending: false,
      };
      state.subscription = acknowledged;
      attempt.phase = "acknowledging";
    } else if (attempt && rejectionId !== undefined && state) {
      attempt.operation.applyResponse(message);
      attempt.phase = "rejecting";
    }
    if (completing && completionState) {
      completing.terminalWritePending = true;
    }

    try {
      await send(message, options);
      if (attempt && acknowledgementId !== undefined && state && acknowledged) {
        this.settleAcknowledgement(acknowledgementId, state, attempt, acknowledged, false);
      } else if (attempt && rejectionId !== undefined && state) {
        this.settleRejection(rejectionId, state, attempt);
      }
      if (completionId !== undefined && completionState && completing) {
        completing.lifecycle.finish("completed");
        if (completionState.subscription === completing) {
          completionState.subscription = undefined;
        }
        this.prune(completionId, completionState);
      }
    } catch (error) {
      attempt?.operation.fail("transport_error", error);
      if (attempt && acknowledgementId !== undefined && state && acknowledged) {
        this.settleAcknowledgement(acknowledgementId, state, attempt, acknowledged, true);
      } else if (attempt && rejectionId !== undefined && state) {
        this.settleRejection(rejectionId, state, attempt);
      }
      if (completionId !== undefined && completionState && completing) {
        completing.lifecycle.finish("transport_error");
        if (completionState.subscription === completing) {
          completionState.subscription = undefined;
        }
        this.prune(completionId, completionState);
      }
      throw error;
    } finally {
      attempt?.operation.finish();
    }
  }

  close(outcome: "connection_closed" | "transport_error", includeSending = false): void {
    this.connectionClosed = true;
    for (const [requestId, state] of this.states) {
      state.attempts = state.attempts.filter((attempt) => {
        if (!includeSending && attempt.phase !== "pending") return true;
        attempt.operation.fail(outcome);
        return false;
      });
      const subscription = state.subscription;
      if (
        subscription &&
        (includeSending ||
          (!subscription.acknowledgementWritePending && !subscription.terminalWritePending))
      ) {
        subscription.lifecycle.finish(outcome);
        state.subscription = undefined;
      }
      this.prune(requestId, state);
    }
  }

  private settleAcknowledgement(
    requestId: RequestId,
    state: StdioSubscriptionState,
    attempt: ListenAttempt,
    subscription: StdioSubscription,
    sendFailed: boolean
  ): void {
    this.removeAttempt(requestId, state, attempt);
    if (state.subscription !== subscription) return;
    subscription.acknowledgementWritePending = false;
    if (subscription.terminalWritePending) {
      this.prune(requestId, state);
      return;
    }
    if (attempt.cancelRequested) {
      subscription.lifecycle.finish("cancelled");
      state.subscription = undefined;
    } else if (this.connectionClosed) {
      subscription.lifecycle.finish(sendFailed ? "transport_error" : "connection_closed");
      state.subscription = undefined;
    }
    // The SDK retains an accepted subscription even when only the ACK write
    // fails, so it must continue consuming capacity until cancel/close.
    this.prune(requestId, state);
  }

  private settleRejection(
    requestId: RequestId,
    state: StdioSubscriptionState,
    attempt: ListenAttempt
  ): void {
    this.removeAttempt(requestId, state, attempt);
    // The queued cancellation is processed after this rejected listen. It can
    // only cancel a pre-existing subscription; otherwise it is a no-op.
    if (
      attempt.cancelRequested &&
      state.subscription &&
      !state.subscription.acknowledgementWritePending &&
      !state.subscription.terminalWritePending
    ) {
      state.subscription.lifecycle.finish("cancelled");
      state.subscription = undefined;
    }
    this.prune(requestId, state);
  }

  private removeAttempt(
    requestId: RequestId,
    state: StdioSubscriptionState,
    attempt: ListenAttempt
  ): void {
    const index = state.attempts.findIndex(
      (candidate) => candidate.operation === attempt.operation
    );
    if (index !== -1) state.attempts.splice(index, 1);
    this.prune(requestId, state);
  }

  private stateFor(requestId: RequestId): StdioSubscriptionState {
    let state = this.states.get(requestId);
    if (!state) {
      state = { attempts: [] };
      this.states.set(requestId, state);
    }
    return state;
  }

  private prune(requestId: RequestId, state: StdioSubscriptionState): void {
    if (
      state.attempts.length === 0 &&
      !state.subscription &&
      this.states.get(requestId) === state
    ) {
      this.states.delete(requestId);
    }
  }

  private observation(protocolVersion?: string): SubscriptionObservation {
    return { networkTransport: "pipe", protocolVersion, route: "stdio" };
  }
}

export function mcpRouteFromUrl(url: string): McpRoute {
  const pathname = new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
  return pathname === "/mcp/oauth" ? "oauth" : "anonymous";
}

interface ModernListenRequest {
  message: JSONRPCMessage;
  protocolVersion?: string;
}

async function modernListenRequest(
  request: Request,
  options?: McpHandlerRequestOptions
): Promise<ModernListenRequest | undefined> {
  let body = options?.parsedBody;
  if (body === undefined) {
    // Avoid cloning and decoding every request. Modern clients identify this
    // method in the standard header, and Node adapters pass parsedBody anyway.
    if (request.headers.get("mcp-method") !== "subscriptions/listen") return undefined;
    try {
      body = await request.clone().json();
    } catch {
      return undefined;
    }
  }

  if (!isJSONRPCRequest(body) || body.method !== "subscriptions/listen") return undefined;
  const classified = classifyInboundRequest({
    body,
    httpMethod: request.method,
    mcpMethodHeader: request.headers.get("mcp-method") ?? undefined,
    mcpNameHeader: request.headers.get("mcp-name") ?? undefined,
    protocolVersionHeader: request.headers.get("mcp-protocol-version") ?? undefined,
  });
  if (
    classified.kind !== "modern" ||
    classified.messageKind !== "request" ||
    classified.message.method !== "subscriptions/listen"
  ) {
    return undefined;
  }
  return {
    message: classified.message,
    protocolVersion: classified.classification.revision,
  };
}

function isSubscriptionStream(response: Response): boolean {
  return (
    response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") === true
  );
}

function wrapSubscriptionStream(
  response: Response,
  lifecycle: SubscriptionLifecycle,
  abortSignal: AbortSignal
): Response {
  const source = response.body;
  if (!source) {
    lifecycle.finish("transport_error");
    return response;
  }

  const reader = source.getReader();
  const observed = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          lifecycle.finish("completed");
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        lifecycle.finish(abortSignal.aborted ? "cancelled" : "transport_error");
        controller.error(error);
      }
    },
    async cancel(reason) {
      lifecycle.finish("cancelled");
      await reader.cancel(reason);
    },
  });
  return new Response(observed, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Observes only the MCP v2 listen route that createMcpHandler serves before it
 * connects a server transport. All other HTTP traffic delegates untouched, so
 * Envoy remains the owner of generic inbound HTTP telemetry.
 */
export function instrumentMcpHttpHandler(
  handler: McpHttpHandler,
  startOperation: StartSubscriptionEntryOperation
): McpHttpHandler {
  const subscriptions = new Set<SubscriptionLifecycle>();
  const finishSubscriptions = (outcome: SubscriptionOutcome): void => {
    for (const subscription of subscriptions) subscription.finish(outcome);
  };
  return {
    bus: handler.bus,
    notify: handler.notify,
    close: async () => {
      try {
        await handler.close();
        finishSubscriptions("completed");
      } catch (error) {
        finishSubscriptions("transport_error");
        throw error;
      }
    },
    fetch: async (request, options) => {
      const listen = await modernListenRequest(request, options);
      if (!listen) return handler.fetch(request, options);

      const observation: SubscriptionObservation = {
        abortSignal: request.signal,
        networkProtocol: "http",
        networkTransport: "tcp",
        protocolVersion: listen.protocolVersion,
        route: mcpRouteFromUrl(request.url),
      };
      const operation = startOperation(listen.message, observation);
      const abortOperation = (): void => operation.fail("cancelled");
      request.signal.addEventListener("abort", abortOperation, { once: true });
      if (request.signal.aborted) abortOperation();

      try {
        const response = await operation.run(() => handler.fetch(request, options));
        if (!isSubscriptionStream(response)) {
          try {
            const message: unknown = await response.clone().json();
            if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
              operation.applyResponse(message);
              operation.finish();
            } else if (response.status >= 500) {
              operation.fail(`http_${response.status}`);
            } else {
              operation.finish();
            }
          } catch {
            if (response.status >= 500) operation.fail(`http_${response.status}`);
            else operation.finish();
          }
          return response;
        }

        // The SDK enqueues the mandatory acknowledgement before resolving
        // fetch. The semantic operation therefore ends here; only the custom
        // subscription lifecycle remains active for the SSE stream lifetime.
        operation.finish();
        let lifecycle!: SubscriptionLifecycle;
        lifecycle = new SubscriptionLifecycle(observation, () => subscriptions.delete(lifecycle));
        subscriptions.add(lifecycle);
        if (request.signal.aborted) lifecycle.finish("cancelled");
        try {
          return wrapSubscriptionStream(response, lifecycle, request.signal);
        } catch (error) {
          lifecycle.finish("transport_error");
          throw error;
        }
      } catch (error) {
        operation.fail(request.signal.aborted ? "cancelled" : "handler_error", error);
        throw error;
      } finally {
        request.signal.removeEventListener("abort", abortOperation);
      }
    },
  };
}
