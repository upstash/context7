import {
  BAGGAGE_META_KEY,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  SUPPORTED_PROTOCOL_VERSIONS,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  isCallToolResult,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type Implementation,
  type JSONRPCMessage,
  type McpRequestContext,
  type McpHttpHandler,
  type MessageExtraInfo,
  type RequestId,
  type ServerOptions,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  isSpanContextValid,
  metrics,
  propagation,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
} from "@opentelemetry/api";
import { MCP_TOOL_NAMES, type ToolCallOutcome } from "./tool-names.js";
import { runInMcpOperationScope } from "./mcp-operation-scope.js";
import {
  StdioSubscriptionTelemetry,
  instrumentMcpHttpHandler as instrumentHttpSubscriptions,
  mcpRouteFromUrl,
  type SubscriptionEntryOperation,
  type SubscriptionObservation,
} from "./mcp-subscription-telemetry.js";

export { mcpRouteFromUrl } from "./mcp-subscription-telemetry.js";

const INSTRUMENTATION_NAME = "io.github.upstash.context7.mcp";
const MCP_DURATION_BUCKETS_SECONDS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300,
];
const KNOWN_MCP_METHODS = new Set([
  "completion/complete",
  "elicitation/create",
  "initialize",
  "logging/setLevel",
  "notifications/cancelled",
  "notifications/elicitation/complete",
  "notifications/initialized",
  "notifications/message",
  "notifications/progress",
  "notifications/prompts/list_changed",
  "notifications/resources/list_changed",
  "notifications/resources/updated",
  "notifications/roots/list_changed",
  "notifications/subscriptions/acknowledged",
  "notifications/tasks/status",
  "notifications/tools/list_changed",
  "ping",
  "prompts/get",
  "prompts/list",
  "resources/list",
  "resources/read",
  "resources/subscribe",
  "resources/templates/list",
  "resources/unsubscribe",
  "roots/list",
  "sampling/createMessage",
  "server/discover",
  "subscriptions/listen",
  "tasks/cancel",
  "tasks/get",
  "tasks/list",
  "tasks/result",
  "tools/call",
  "tools/list",
]);
const KNOWN_TOOLS: ReadonlySet<string> = new Set(MCP_TOOL_NAMES);
export const MODERN_MCP_PROTOCOL_VERSION = "2026-07-28";
const KNOWN_PROTOCOL_VERSIONS = new Set([
  ...SUPPORTED_PROTOCOL_VERSIONS,
  MODERN_MCP_PROTOCOL_VERSION,
]);
const EMPTY_TRACE_CARRIER: Record<string, string> = Object.freeze({});

type McpObservationConfig = SubscriptionObservation;

type McpOperationState = "finished" | "handling" | "sending";

interface McpOperation {
  activeAttributes: Attributes;
  attributes: Attributes;
  context: Context;
  errorType?: string;
  requestId?: RequestId;
  span: Span;
  state: McpOperationState;
  statusDescription?: string;
  startedAt: number;
  toolOutcome?: ToolCallOutcome;
}

interface ServerResponseClassification {
  errorType?: string;
  rpcStatusCode?: string;
  statusDescription?: string;
}

const CALLER_FAULT_CODES = new Set([-32700, -32600, -32601, -32602, -32002]);

function getInstruments() {
  const meter = metrics.getMeter(INSTRUMENTATION_NAME);
  return {
    operationDuration: meter.createHistogram("mcp.server.operation.duration", {
      description:
        "MCP request or notification duration from receipt until the result or acknowledgement is sent",
      unit: "s",
      advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS_SECONDS },
    }),
    sessionDuration: meter.createHistogram("mcp.server.session.duration", {
      description: "Duration of a stateful MCP server session",
      unit: "s",
      advice: { explicitBucketBoundaries: MCP_DURATION_BUCKETS_SECONDS },
    }),
    activeOperations: meter.createUpDownCounter("context7.mcp.operations.active", {
      description: "Number of MCP requests and notifications currently being handled",
      unit: "{operation}",
    }),
  };
}

let instruments: ReturnType<typeof getInstruments> | undefined;

function mcpInstruments(): ReturnType<typeof getInstruments> {
  instruments ??= getInstruments();
  return instruments;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeMcpMethodName(method: unknown): string {
  return typeof method === "string" && KNOWN_MCP_METHODS.has(method) ? method : "unknown";
}

export function normalizeMcpToolName(tool: unknown): string {
  return typeof tool === "string" && KNOWN_TOOLS.has(tool) ? tool : "unknown";
}

function normalizedTool(message: JSONRPCMessage): string | undefined {
  if (!isJSONRPCRequest(message) || message.method !== "tools/call") return undefined;

  const name = asRecord(message.params)?.name;
  return normalizeMcpToolName(name);
}

function normalizedProtocolVersion(value: unknown): string | undefined {
  return typeof value === "string" && KNOWN_PROTOCOL_VERSIONS.has(value) ? value : undefined;
}

function messageProtocolVersion(message: JSONRPCMessage): string | undefined {
  if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) return undefined;

  const params = asRecord(message.params);
  const metadata = asRecord(params?._meta);
  return (
    normalizedProtocolVersion(metadata?.[PROTOCOL_VERSION_META_KEY]) ??
    normalizedProtocolVersion(params?.protocolVersion)
  );
}

export function mcpTraceCarrier(message: JSONRPCMessage): Record<string, string> {
  if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) return EMPTY_TRACE_CARRIER;

  const metadata = asRecord(asRecord(message.params)?._meta);
  if (!metadata) return EMPTY_TRACE_CARRIER;

  const carrier: Record<string, string> = {};
  for (const key of [TRACEPARENT_META_KEY, TRACESTATE_META_KEY, BAGGAGE_META_KEY]) {
    const value = metadata[key];
    if (typeof value === "string") carrier[key] = value;
  }
  return carrier;
}

function ambientLink(parentContext: Context): Link[] | undefined {
  const ambient = trace.getSpan(context.active())?.spanContext();
  const parent = trace.getSpan(parentContext)?.spanContext();
  if (!ambient || !isSpanContextValid(ambient)) return undefined;
  if (parent && ambient.traceId === parent.traceId && ambient.spanId === parent.spanId) {
    return undefined;
  }
  return [{ context: ambient }];
}

function elapsedSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1_000;
}

function requestIdAttribute(requestId: RequestId): string | undefined {
  return requestId === null ? undefined : String(requestId);
}

function startOperation(
  message: JSONRPCMessage,
  config: McpObservationConfig,
  transportProtocolVersion?: string
): McpOperation | undefined {
  if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) return undefined;

  const method = normalizeMcpMethodName(message.method);
  const tool = normalizedTool(message);
  const protocolVersion =
    messageProtocolVersion(message) ?? transportProtocolVersion ?? config.protocolVersion;
  const activeAttributes: Attributes = {
    "context7.mcp.route": config.route,
    "mcp.method.name": method,
  };
  const attributes: Attributes = {
    ...activeAttributes,
    "network.transport": config.networkTransport,
  };
  if (config.networkProtocol) attributes["network.protocol.name"] = config.networkProtocol;
  if (protocolVersion) attributes["mcp.protocol.version"] = protocolVersion;
  if (tool) {
    activeAttributes["gen_ai.tool.name"] = tool;
    attributes["gen_ai.tool.name"] = tool;
    attributes["gen_ai.operation.name"] = "execute_tool";
  }

  const requestId = isJSONRPCRequest(message) ? message.id : undefined;
  const parentContext = propagation.extract(ROOT_CONTEXT, mcpTraceCarrier(message));
  const span = trace.getTracer(INSTRUMENTATION_NAME).startSpan(
    tool ? `${method} ${tool}` : method,
    {
      attributes,
      kind: SpanKind.SERVER,
      links: ambientLink(parentContext),
    },
    parentContext
  );
  if (requestId !== undefined) {
    const requestIdValue = requestIdAttribute(requestId);
    if (requestIdValue) span.setAttribute("jsonrpc.request.id", requestIdValue);
  }
  const operation = {
    activeAttributes,
    attributes,
    context: ROOT_CONTEXT,
    requestId,
    span,
    state: "handling",
    startedAt: performance.now(),
  } satisfies McpOperation;
  operation.context = trace.setSpan(parentContext, span);
  mcpInstruments().activeOperations.add(1, activeAttributes);
  return operation;
}

function finishOperation(operation: McpOperation): void {
  if (operation.state === "finished") return;
  operation.state = "finished";

  const attributes: Attributes =
    operation.errorType || operation.toolOutcome
      ? { ...operation.attributes }
      : operation.attributes;
  if (operation.errorType) attributes["error.type"] = operation.errorType;
  if (operation.toolOutcome) {
    attributes["context7.mcp.tool.outcome"] = operation.toolOutcome;
    operation.span.setAttribute("context7.mcp.tool.outcome", operation.toolOutcome);
  }

  const { activeOperations, operationDuration } = mcpInstruments();
  activeOperations.add(-1, operation.activeAttributes);
  operationDuration.record(elapsedSeconds(operation.startedAt), attributes);
  if (operation.errorType) {
    operation.span.setAttribute("error.type", operation.errorType);
    operation.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: operation.statusDescription,
    });
  }
  operation.span.end();
}

function operationIsFinished(operation: McpOperation): boolean {
  return operation.state === "finished";
}

function runOperation<T>(operation: McpOperation, handler: () => T): T {
  return runInMcpOperationScope(operation, () => context.with(operation.context, handler));
}

export function classifyServerResponse(
  message: JSONRPCMessage,
  operationMethod: unknown
): ServerResponseClassification {
  if (isJSONRPCErrorResponse(message)) {
    return {
      errorType: CALLER_FAULT_CODES.has(message.error.code)
        ? undefined
        : String(message.error.code),
      rpcStatusCode: String(message.error.code),
      statusDescription: message.error.message,
    };
  }
  if (
    isJSONRPCResultResponse(message) &&
    operationMethod === "tools/call" &&
    isCallToolResult(message.result) &&
    message.result.isError
  ) {
    return { errorType: "tool_error" };
  }
  return {};
}

function applyServerResponse(message: JSONRPCMessage, operation: McpOperation): void {
  const classification = classifyServerResponse(message, operation.attributes["mcp.method.name"]);
  // A JSON-RPC error is the canonical final classification, including caller
  // faults that intentionally clear a provisional server error. Successful
  // envelopes retain an application-level tool_error captured by the tool
  // wrapper when the SDK normalizes the result before transport serialization.
  if (isJSONRPCErrorResponse(message) || classification.errorType) {
    operation.errorType = classification.errorType;
  }
  if (classification.errorType && operation.attributes["mcp.method.name"] === "tools/call") {
    operation.toolOutcome = "error";
  }
  operation.statusDescription = classification.statusDescription;
  if (classification.rpcStatusCode) {
    operation.attributes["rpc.response.status_code"] = classification.rpcStatusCode;
    operation.span.setAttribute("rpc.response.status_code", classification.rpcStatusCode);
  }
}

function cancellationRequestId(message: JSONRPCMessage): RequestId | undefined {
  if (!isJSONRPCNotification(message) || message.method !== "notifications/cancelled") {
    return undefined;
  }

  const requestId = asRecord(message.params)?.requestId;
  return typeof requestId === "string" || typeof requestId === "number" ? requestId : undefined;
}

function configFromRequestContext(requestContext: McpRequestContext): McpObservationConfig {
  const request = requestContext.requestInfo;
  if (!request) {
    return {
      route: "stdio",
      networkTransport: "pipe",
      protocolVersion: requestContext.era === "modern" ? MODERN_MCP_PROTOCOL_VERSION : undefined,
    };
  }

  return {
    abortSignal: request.signal,
    route: mcpRouteFromUrl(request.url),
    networkProtocol: "http",
    networkTransport: "tcp",
    protocolVersion:
      normalizedProtocolVersion(request.headers.get("mcp-protocol-version")) ??
      (requestContext.era === "modern" ? MODERN_MCP_PROTOCOL_VERSION : undefined),
  };
}

function startSubscriptionEntryOperation(
  message: JSONRPCMessage,
  observation: SubscriptionObservation
): SubscriptionEntryOperation {
  const operation = startOperation(message, {
    ...observation,
    protocolVersion: normalizedProtocolVersion(observation.protocolVersion),
  });
  if (!operation) throw new TypeError("Expected an MCP request or notification");
  return {
    applyResponse(response) {
      if (!operationIsFinished(operation)) applyServerResponse(response, operation);
    },
    fail(errorType, error) {
      if (operationIsFinished(operation)) return;
      operation.errorType = errorType;
      operation.statusDescription = error instanceof Error ? error.message : undefined;
      if (error instanceof Error) operation.span.recordException(error);
      finishOperation(operation);
    },
    finish() {
      finishOperation(operation);
    },
    run: <T>(callback: () => T): T => runOperation(operation, callback),
  };
}

export function instrumentMcpHttpHandler(handler: McpHttpHandler): McpHttpHandler {
  return instrumentHttpSubscriptions(handler, startSubscriptionEntryOperation);
}

class InstrumentedTransport implements Transport {
  private readonly abortSignal?: AbortSignal;
  private readonly inFlight = new Map<RequestId, McpOperation>();
  private messageHandler: Transport["onmessage"];
  private closeHandler: Transport["onclose"];
  private errorHandler: Transport["onerror"];
  private protocolVersion?: string;

  constructor(
    private readonly transport: Transport,
    private readonly config: McpObservationConfig
  ) {
    this.abortSignal = config.abortSignal;
    this.protocolVersion = config.protocolVersion;
    this.onclose = transport.onclose;
    this.onerror = transport.onerror;
    this.onmessage = transport.onmessage;
    this.abortSignal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  private readonly handleAbort = (): void => {
    this.finishAll("cancelled", true);
  };

  get hasPerRequestStream(): boolean | undefined {
    return this.transport.hasPerRequestStream;
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  set sessionId(value: string | undefined) {
    this.transport.sessionId = value;
  }

  get onclose(): Transport["onclose"] {
    return this.closeHandler;
  }

  set onclose(handler: Transport["onclose"]) {
    this.closeHandler = handler;
    this.transport.onclose = () => {
      this.finishAll("connection_closed");
      this.detachAbortHandler();
      handler?.();
    };
  }

  get onerror(): Transport["onerror"] {
    return this.errorHandler;
  }

  set onerror(handler: Transport["onerror"]) {
    this.errorHandler = handler;
    this.transport.onerror = handler;
  }

  get onmessage(): Transport["onmessage"] {
    return this.messageHandler;
  }

  set onmessage(handler: Transport["onmessage"]) {
    this.messageHandler = handler;
    this.transport.onmessage = handler
      ? (message, extra) => this.receive(message, extra, handler)
      : undefined;
  }

  setProtocolVersion = (version: string): void => {
    this.protocolVersion = normalizedProtocolVersion(version);
    this.transport.setProtocolVersion?.(version);
  };

  setSupportedProtocolVersions = (versions: string[]): void => {
    this.transport.setSupportedProtocolVersions?.(versions);
  };

  async start(): Promise<void> {
    await this.transport.start();
  }

  async close(): Promise<void> {
    try {
      await this.transport.close();
    } finally {
      this.finishAll("connection_closed");
      this.detachAbortHandler();
    }
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const responseId =
      isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message) ? message.id : undefined;
    const operation =
      responseId !== undefined && responseId !== null ? this.inFlight.get(responseId) : undefined;
    try {
      if (!operation) {
        await this.transport.send(message, options);
        return;
      }

      applyServerResponse(message, operation);
      operation.state = "sending";
      await this.transport.send(message, options);
    } catch (error) {
      if (operation && !operationIsFinished(operation)) {
        operation.errorType = "transport_error";
        operation.statusDescription = error instanceof Error ? error.message : undefined;
        if (error instanceof Error) operation.span.recordException(error);
      }
      throw error;
    } finally {
      if (operation) {
        this.removeInFlight(operation);
        finishOperation(operation);
      }
    }
  }

  private receive(
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    handler: NonNullable<Transport["onmessage"]>
  ): void {
    const operation = startOperation(message, this.config, this.protocolVersion);
    if (!operation) {
      handler(message, extra);
      return;
    }

    if (operation.requestId !== undefined && operation.requestId !== null) {
      const previous = this.inFlight.get(operation.requestId);
      if (previous) {
        previous.errorType = "duplicate_request_id";
        finishOperation(previous);
      }
      this.inFlight.set(operation.requestId, operation);
    }

    try {
      runOperation(operation, () => handler(message, extra));
    } catch (error) {
      operation.errorType = "handler_error";
      if (error instanceof Error) operation.span.recordException(error);
      if (operation.requestId !== undefined && operation.requestId !== null) {
        this.inFlight.delete(operation.requestId);
      }
      finishOperation(operation);
      throw error;
    }

    if (isJSONRPCNotification(message)) {
      const cancelledRequestId = cancellationRequestId(message);
      if (cancelledRequestId !== undefined) this.cancelOperation(cancelledRequestId);
      finishOperation(operation);
    }
  }

  private cancelOperation(requestId: RequestId): void {
    const operation = this.inFlight.get(requestId);
    if (!operation) return;

    operation.errorType = "cancelled";
    this.inFlight.delete(requestId);
    finishOperation(operation);
  }

  private removeInFlight(operation: McpOperation): void {
    const requestId = operation.requestId;
    if (
      requestId !== undefined &&
      requestId !== null &&
      this.inFlight.get(requestId) === operation
    ) {
      this.inFlight.delete(requestId);
    }
  }

  private detachAbortHandler(): void {
    this.abortSignal?.removeEventListener("abort", this.handleAbort);
  }

  private finishAll(errorType: string, includeSending = false): void {
    for (const [requestId, operation] of this.inFlight) {
      // A normal per-request HTTP transport closes its stream from inside send().
      // Let an active send settle so its success or failure remains authoritative.
      if (operation.state === "sending" && !includeSending) continue;
      operation.errorType ??= errorType;
      finishOperation(operation);
      this.inFlight.delete(requestId);
    }
  }
}

/**
 * Owns session telemetry at the one process-level stdio wire. The SDK may
 * create multiple products while probing protocol eras, but they all share
 * this transport, which also receives the actually negotiated version.
 */
class InstrumentedStdioTransport implements Transport {
  private closeHandler: Transport["onclose"];
  private closePromise: Promise<void> | undefined;
  private closeRequested = false;
  private errorType?: string;
  private errorHandler: Transport["onerror"];
  private finished = false;
  private messageHandler: Transport["onmessage"];
  private pendingTerminalError = false;
  private protocolVersion?: string;
  private readonly startedAt = performance.now();
  private readonly subscriptions = new StdioSubscriptionTelemetry(
    startSubscriptionEntryOperation,
    MODERN_MCP_PROTOCOL_VERSION
  );

  constructor(private readonly transport: Transport) {
    this.onclose = transport.onclose;
    this.onerror = transport.onerror;
    this.onmessage = transport.onmessage;
  }

  get hasPerRequestStream(): boolean | undefined {
    return this.transport.hasPerRequestStream;
  }

  get sessionId(): string | undefined {
    return this.transport.sessionId;
  }

  set sessionId(value: string | undefined) {
    this.transport.sessionId = value;
  }

  get onclose(): Transport["onclose"] {
    return this.closeHandler;
  }

  set onclose(handler: Transport["onclose"]) {
    this.closeHandler = handler;
    this.transport.onclose = () => {
      this.subscriptions.close("connection_closed");
      if (!this.closeRequested) {
        this.finish(this.pendingTerminalError ? "transport_error" : undefined);
      }
      handler?.();
    };
  }

  get onerror(): Transport["onerror"] {
    return this.errorHandler;
  }

  set onerror(handler: Transport["onerror"]) {
    this.errorHandler = handler;
    this.transport.onerror = (error) => {
      this.pendingTerminalError = true;
      queueMicrotask(() => {
        this.pendingTerminalError = false;
      });
      handler?.(error);
    };
  }

  get onmessage(): Transport["onmessage"] {
    return this.messageHandler;
  }

  set onmessage(handler: Transport["onmessage"]) {
    this.messageHandler = handler;
    this.transport.onmessage = handler
      ? (message, extra) => this.receive(message, extra, handler)
      : undefined;
  }

  setProtocolVersion = (version: string): void => {
    this.protocolVersion = normalizedProtocolVersion(version);
    this.transport.setProtocolVersion?.(version);
  };

  setSupportedProtocolVersions = (versions: string[]): void => {
    this.transport.setSupportedProtocolVersions?.(versions);
  };

  async start(): Promise<void> {
    try {
      await this.transport.start();
    } catch (error) {
      this.errorType = "transport_error";
      this.finish("transport_error");
      throw error;
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closeRequested = true;
      this.closePromise = this.closeTransport();
    }
    return this.closePromise;
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      await this.subscriptions.send(
        message,
        options,
        (outbound, sendOptions) => this.transport.send(outbound, sendOptions),
        this.protocolVersion
      );
    } catch (error) {
      this.errorType ??= "transport_error";
      throw error;
    }
  }

  private receive(
    message: JSONRPCMessage,
    extra: MessageExtraInfo | undefined,
    handler: NonNullable<Transport["onmessage"]>
  ): void {
    this.protocolVersion = messageProtocolVersion(message) ?? this.protocolVersion;
    if (this.subscriptions.receive(message, extra, handler, this.protocolVersion)) return;
    handler(message, extra);
  }

  private async closeTransport(): Promise<void> {
    try {
      await this.transport.close();
      this.subscriptions.close("connection_closed", true);
      this.finish();
    } catch (error) {
      this.errorType = "transport_error";
      this.subscriptions.close("transport_error", true);
      this.finish("transport_error");
      throw error;
    }
  }

  private finish(errorType = this.errorType): void {
    if (this.finished) return;
    this.finished = true;

    const attributes: Attributes = { "network.transport": "pipe" };
    if (this.protocolVersion) attributes["mcp.protocol.version"] = this.protocolVersion;
    if (errorType) attributes["error.type"] = errorType;
    mcpInstruments().sessionDuration.record(elapsedSeconds(this.startedAt), attributes);
  }
}

export function instrumentStdioTransport(transport: Transport): Transport {
  return new InstrumentedStdioTransport(transport);
}

/**
 * High-level MCP server with protocol-aware OpenTelemetry at the SDK transport
 * boundary. This observes individual JSON-RPC operations for HTTP and stdio,
 * including batched messages, instead of treating an HTTP envelope as one MCP
 * operation.
 */
export class InstrumentedMcpServer extends McpServer {
  constructor(
    serverInfo: Implementation,
    options: ServerOptions,
    private readonly requestContext: McpRequestContext
  ) {
    super(serverInfo, options);
  }

  override connect(transport: Transport): Promise<void> {
    return super.connect(
      new InstrumentedTransport(transport, configFromRequestContext(this.requestContext))
    );
  }
}
