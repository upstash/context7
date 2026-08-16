import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  type JSONRPCMessage,
  type MessageExtraInfo,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { SpanStatusCode, metrics, propagation, trace } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { InstrumentedMcpServer, classifyServerResponse } from "../src/lib/mcp-telemetry.js";
import { observeUpstreamRequest, type UpstreamOperation } from "../src/lib/telemetry.js";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class ControlledTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  readonly sent: JSONRPCMessage[] = [];
  closeOperation: () => Promise<void> = async () => undefined;
  sendOperation: (message: JSONRPCMessage, options?: TransportSendOptions) => Promise<void> =
    async () => undefined;

  async start(): Promise<void> {}

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.sent.push(message);
    return this.sendOperation(message, options);
  }

  async close(): Promise<void> {
    this.onclose?.();
    await this.closeOperation();
  }

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  triggerClose(): void {
    this.onclose?.();
  }

  triggerError(error: Error): void {
    this.onerror?.(error);
  }
}

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
    }),
  ],
});

beforeAll(() => {
  expect(trace.setGlobalTracerProvider(tracerProvider)).toBe(true);
  expect(metrics.setGlobalMeterProvider(metricProvider)).toBe(true);
});

beforeEach(() => {
  spanExporter.reset();
});

afterAll(async () => {
  await metricProvider.shutdown();
  await tracerProvider.shutdown();
  metrics.disable();
  trace.disable();
  propagation.disable();
});

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw lastError;
}

function serverFor(
  transport: ControlledTransport,
  requestInfo?: Request,
  era: "legacy" | "modern" = "legacy"
): InstrumentedMcpServer {
  const server = new InstrumentedMcpServer(
    { name: "telemetry-lifecycle-test", version: "1.0.0" },
    {},
    { era, requestInfo }
  );
  server.server.onerror = () => undefined;
  void server.connect(transport);
  return server;
}

function sessionObservationCount(): number {
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === "mcp.server.session.duration");
  if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) return 0;
  return metric.dataPoints.reduce((total, point) => total + point.value.count, 0);
}

function sessionErrorObservationCount(errorType: string): number {
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === "mcp.server.session.duration");
  if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) return 0;
  return metric.dataPoints
    .filter((point) => point.attributes["error.type"] === errorType)
    .reduce((total, point) => total + point.value.count, 0);
}

function upstreamObservationCount(operation: UpstreamOperation, outcome: string): number {
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === "context7.mcp.upstream.requests");
  if (!metric || metric.dataPointType !== DataPointType.SUM) return 0;
  return metric.dataPoints
    .filter(
      (point) =>
        point.attributes["context7.upstream.operation"] === operation &&
        point.attributes["context7.upstream.outcome"] === outcome
    )
    .reduce((total, point) => total + point.value, 0);
}

function responseFor(id: string | number, code: number): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message: `error ${code}` },
  };
}

describe("MCP server response classification", () => {
  test.each([-32700, -32600, -32601, -32602, -32002])(
    "treats caller fault %i as a non-server error",
    (code) => {
      expect(classifyServerResponse(responseFor(1, code), "tools/call")).toEqual({
        errorType: undefined,
        rpcStatusCode: String(code),
        statusDescription: `error ${code}`,
      });
    }
  );

  test("classifies internal JSON-RPC and logical tool errors", () => {
    expect(classifyServerResponse(responseFor(1, -32603), "tools/call")).toMatchObject({
      errorType: "-32603",
      rpcStatusCode: "-32603",
    });
    expect(
      classifyServerResponse(
        {
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "failed" }], isError: true },
        },
        "tools/call"
      )
    ).toEqual({ errorType: "tool_error" });
  });
});

describe("MCP operation lifecycle", () => {
  test("records real stdio sessions but not stateless HTTP request transports", async () => {
    await metricProvider.forceFlush();
    const before = sessionObservationCount();

    const stdioTransport = new ControlledTransport();
    const stdioServer = serverFor(stdioTransport, undefined, "modern");
    await eventually(() => expect(stdioTransport.onmessage).toBeTypeOf("function"));
    await stdioServer.close();
    await metricProvider.forceFlush();

    expect(sessionObservationCount()).toBe(before + 1);
    const latest = metricExporter.getMetrics().at(-1);
    const sessionMetric = latest?.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((candidate) => candidate.descriptor.name === "mcp.server.session.duration");
    expect(
      sessionMetric?.dataPoints.some(
        (point) =>
          point.attributes["network.transport"] === "pipe" &&
          point.attributes["mcp.protocol.version"] === "2026-07-28"
      )
    ).toBe(true);

    const httpTransport = new ControlledTransport();
    const httpServer = serverFor(httpTransport, new Request("http://127.0.0.1/mcp"));
    await eventually(() => expect(httpTransport.onmessage).toBeTypeOf("function"));
    await httpServer.close();
    await metricProvider.forceFlush();

    expect(sessionObservationCount()).toBe(before + 1);
  });

  test("does not fail a gracefully closed session after a nonfatal transport error event", async () => {
    await metricProvider.forceFlush();
    const beforeTotal = sessionObservationCount();
    const beforeErrors = sessionErrorObservationCount("transport_error");
    const transport = new ControlledTransport();
    const server = serverFor(transport, undefined, "modern");
    await eventually(() => expect(transport.onerror).toBeTypeOf("function"));

    transport.triggerError(new Error("reported but recoverable"));
    await server.close();
    await metricProvider.forceFlush();

    expect(sessionObservationCount()).toBe(beforeTotal + 1);
    expect(sessionErrorObservationCount("transport_error")).toBe(beforeErrors);
  });

  test("marks a session failed when terminal transport close rejects", async () => {
    await metricProvider.forceFlush();
    const beforeErrors = sessionErrorObservationCount("transport_error");
    const transport = new ControlledTransport();
    transport.closeOperation = async () => {
      throw new Error("close failed");
    };
    const server = serverFor(transport, undefined, "modern");
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    await expect(server.close()).rejects.toThrow("close failed");
    await metricProvider.forceFlush();

    expect(sessionErrorObservationCount("transport_error")).toBe(beforeErrors + 1);
  });

  test("records caller faults without marking the server span as failed", async () => {
    const transport = new ControlledTransport();
    const server = serverFor(transport);
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    transport.receive({ jsonrpc: "2.0", id: 1, method: "not/a-real-method" });
    await eventually(() => expect(transport.sent).toHaveLength(1));
    await tracerProvider.forceFlush();

    const span = spanExporter.getFinishedSpans().find((candidate) => candidate.name === "unknown");
    expect(span?.status.code).toBe(SpanStatusCode.UNSET);
    expect(span?.attributes).toMatchObject({ "rpc.response.status_code": "-32601" });
    expect(span?.attributes).not.toHaveProperty("error.type");
    await server.close();
  });

  test("marks true server failures and records the JSON-RPC status on the span", async () => {
    const transport = new ControlledTransport();
    const server = serverFor(transport);
    server.server.setRequestHandler("ping", async () => {
      throw new Error("handler exploded");
    });
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    transport.receive({ jsonrpc: "2.0", id: 2, method: "ping" });
    await eventually(() => expect(transport.sent).toHaveLength(1));
    await tracerProvider.forceFlush();

    const span = spanExporter.getFinishedSpans().find((candidate) => candidate.name === "ping");
    expect(span?.status).toMatchObject({ code: SpanStatusCode.ERROR, message: "handler exploded" });
    expect(span?.attributes).toMatchObject({
      "error.type": "-32603",
      "rpc.response.status_code": "-32603",
    });
    await server.close();
  });

  test("finishes the target operation when a cancellation notification arrives", async () => {
    const transport = new ControlledTransport();
    const handler = deferred<Record<string, never>>();
    const server = serverFor(transport);
    server.server.setRequestHandler("ping", () => handler.promise);
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    transport.receive({ jsonrpc: "2.0", id: 3, method: "ping" });
    transport.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 3 },
    });
    await tracerProvider.forceFlush();

    const target = spanExporter.getFinishedSpans().find((candidate) => candidate.name === "ping");
    expect(target?.status.code).toBe(SpanStatusCode.ERROR);
    expect(target?.attributes["error.type"]).toBe("cancelled");
    handler.resolve({});
    await server.close();
  });

  test("finishes an HTTP operation when the request stream is aborted", async () => {
    const transport = new ControlledTransport();
    const handler = deferred<Record<string, never>>();
    const abortController = new AbortController();
    const server = serverFor(
      transport,
      new Request("http://127.0.0.1/mcp", { signal: abortController.signal })
    );
    server.server.setRequestHandler("ping", () => handler.promise);
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    transport.receive({ jsonrpc: "2.0", id: 4, method: "ping" });
    abortController.abort();
    await tracerProvider.forceFlush();

    const target = spanExporter.getFinishedSpans().find((candidate) => candidate.name === "ping");
    expect(target?.attributes["error.type"]).toBe("cancelled");
    handler.resolve({});
    await server.close();
  });

  test("lets an in-progress send settle before classifying a close", async () => {
    const transport = new ControlledTransport();
    const send = deferred<void>();
    transport.sendOperation = () => send.promise;
    const server = serverFor(transport);
    await eventually(() => expect(transport.onmessage).toBeTypeOf("function"));

    transport.receive({ jsonrpc: "2.0", id: 5, method: "ping" });
    await eventually(() => expect(transport.sent).toHaveLength(1));
    transport.triggerClose();
    await tracerProvider.forceFlush();
    expect(spanExporter.getFinishedSpans().some((candidate) => candidate.name === "ping")).toBe(
      false
    );

    send.reject(new Error("broken output"));
    await eventually(() =>
      expect(
        spanExporter.getFinishedSpans().find((candidate) => candidate.name === "ping")
      ).toBeDefined()
    );
    const span = spanExporter.getFinishedSpans().find((candidate) => candidate.name === "ping");
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes["error.type"]).toBe("transport_error");
    await server.close();
  });
});

describe("upstream request lifecycle", () => {
  test.each([
    ["fetch_context", "timeout", new DOMException("timed out", "TimeoutError")],
    ["search_libraries", "cancelled", new DOMException("cancelled", "AbortError")],
  ] as const)("records body-phase %s failures as %s", async (operation, outcome, reason) => {
    await metricProvider.forceFlush();
    const before = upstreamObservationCount(operation, outcome);
    const abortController = new AbortController();

    await expect(
      observeUpstreamRequest(
        operation,
        async () => new Response("partial body"),
        async () => {
          abortController.abort(reason);
          throw new DOMException("body aborted", "AbortError");
        },
        { abortSignal: abortController.signal }
      )
    ).rejects.toThrow("body aborted");
    await metricProvider.forceFlush();

    expect(upstreamObservationCount(operation, outcome)).toBe(before + 1);
  });
});
