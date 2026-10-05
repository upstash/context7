import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
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
import {
  InstrumentedMcpServer,
  MODERN_MCP_PROTOCOL_VERSION,
  instrumentMcpHttpHandler,
  instrumentStdioTransport,
} from "../src/lib/mcp-telemetry.js";

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

function sumMetricValue(
  metricName: string,
  matches: (attributes: Record<string, unknown>) => boolean = () => true
): number {
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === metricName);
  if (!metric || metric.dataPointType !== DataPointType.SUM) return 0;
  return metric.dataPoints
    .filter((point) => matches(point.attributes))
    .reduce((total, point) => total + point.value, 0);
}

function histogramObservationCount(
  metricName: string,
  matches: (attributes: Record<string, unknown>) => boolean = () => true
): number {
  const latest = metricExporter.getMetrics().at(-1);
  const metric = latest?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === metricName);
  if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) return 0;
  return metric.dataPoints
    .filter((point) => matches(point.attributes))
    .reduce((total, point) => total + point.value.count, 0);
}

function activeSubscriptionCount(route: "anonymous" | "oauth" | "stdio"): number {
  return sumMetricValue(
    "context7.mcp.subscriptions.active",
    (attributes) => attributes["context7.mcp.route"] === route
  );
}

function subscriptionDurationCount(outcome: string, route?: string): number {
  return histogramObservationCount(
    "context7.mcp.subscription.duration",
    (attributes) =>
      attributes["context7.mcp.subscription.outcome"] === outcome &&
      (route === undefined || attributes["context7.mcp.route"] === route)
  );
}

function operationCount(method: string): number {
  return histogramObservationCount(
    "mcp.server.operation.duration",
    (attributes) => attributes["mcp.method.name"] === method
  );
}

function modernListenRequest(
  id: string | number,
  notifications: Record<string, boolean | string[]> | null = {}
): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "subscriptions/listen",
    params: {
      ...(notifications === null ? {} : { notifications }),
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
}

function modernHttpRequest(method: string, signal?: AbortSignal): Request {
  return new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": MODERN_MCP_PROTOCOL_VERSION,
    },
    signal,
  });
}

function createInstrumentedHttpHandler(maxSubscriptions = 4) {
  const raw = createMcpHandler(
    (requestContext) =>
      new InstrumentedMcpServer(
        { name: "subscription-http-test", version: "1.0.0" },
        {},
        requestContext
      ),
    { keepAliveMs: 0, maxSubscriptions, onerror: () => undefined }
  );
  return instrumentMcpHttpHandler(raw);
}

describe("MCP v2 subscription telemetry", () => {
  test("ends the HTTP operation at acknowledgement and tracks the stream until abort", async () => {
    await metricProvider.forceFlush();
    const beforeOperations = operationCount("subscriptions/listen");
    const beforeActive = activeSubscriptionCount("anonymous");
    const beforeCancelled = subscriptionDurationCount("cancelled", "anonymous");
    const handler = createInstrumentedHttpHandler();
    const abort = new AbortController();
    const message = modernListenRequest(101);

    const response = await handler.fetch(modernHttpRequest("subscriptions/listen", abort.signal), {
      parsedBody: message,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const acknowledgement = await reader.read();
    expect(new TextDecoder().decode(acknowledgement.value)).toContain(
      "notifications/subscriptions/acknowledged"
    );

    await metricProvider.forceFlush();
    await tracerProvider.forceFlush();
    expect(operationCount("subscriptions/listen")).toBe(beforeOperations + 1);
    expect(activeSubscriptionCount("anonymous")).toBe(beforeActive + 1);
    expect(
      spanExporter.getFinishedSpans().filter((span) => span.name === "subscriptions/listen")
    ).toHaveLength(1);

    abort.abort();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("anonymous")).toBe(beforeActive);
    expect(subscriptionDurationCount("cancelled", "anonymous")).toBe(beforeCancelled + 1);
    await reader.cancel();
    await handler.close();
  });

  test("classifies HTTP invalid params and capacity rejection without opening subscriptions", async () => {
    await metricProvider.forceFlush();
    const beforeOperations = operationCount("subscriptions/listen");
    const beforeActive = activeSubscriptionCount("anonymous");
    const handler = createInstrumentedHttpHandler(1);

    const invalid = modernListenRequest(102, null);
    const invalidResponse = await handler.fetch(modernHttpRequest("subscriptions/listen"), {
      parsedBody: invalid,
    });
    expect(await invalidResponse.json()).toMatchObject({ error: { code: -32602 }, id: 102 });

    const abort = new AbortController();
    const accepted = modernListenRequest(103);
    const acceptedResponse = await handler.fetch(
      modernHttpRequest("subscriptions/listen", abort.signal),
      { parsedBody: accepted }
    );
    expect(acceptedResponse.headers.get("content-type")).toContain("text/event-stream");

    const rejected = modernListenRequest(104);
    const rejectedResponse = await handler.fetch(modernHttpRequest("subscriptions/listen"), {
      parsedBody: rejected,
    });
    expect(await rejectedResponse.json()).toMatchObject({ error: { code: -32603 }, id: 104 });

    await metricProvider.forceFlush();
    await tracerProvider.forceFlush();
    expect(operationCount("subscriptions/listen")).toBe(beforeOperations + 3);
    expect(activeSubscriptionCount("anonymous")).toBe(beforeActive + 1);
    const listenSpans = spanExporter
      .getFinishedSpans()
      .filter((span) => span.name === "subscriptions/listen");
    expect(
      listenSpans.find((span) => span.attributes["rpc.response.status_code"] === "-32602")?.status
        .code
    ).toBe(SpanStatusCode.UNSET);
    expect(
      listenSpans.find((span) => span.attributes["rpc.response.status_code"] === "-32603")
        ?.attributes["error.type"]
    ).toBe("-32603");

    abort.abort();
    await handler.close();
  });

  test("handler close completes an unconsumed HTTP subscription without leaking the gauge", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("anonymous");
    const beforeCompleted = subscriptionDurationCount("completed", "anonymous");
    const handler = createInstrumentedHttpHandler();

    const response = await handler.fetch(modernHttpRequest("subscriptions/listen"), {
      parsedBody: modernListenRequest(105),
    });
    expect(response.body).not.toBeNull();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("anonymous")).toBe(beforeActive + 1);

    await handler.close();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("anonymous")).toBe(beforeActive);
    expect(subscriptionDurationCount("completed", "anonymous")).toBe(beforeCompleted + 1);
  });

  test("delegates ordinary HTTP operations without double counting them", async () => {
    await metricProvider.forceFlush();
    const before = operationCount("tools/list");
    const handler = createInstrumentedHttpHandler();
    const message: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 106,
      method: "tools/list",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    };

    const response = await handler.fetch(modernHttpRequest("tools/list"), {
      parsedBody: message,
    });
    await response.text();
    await metricProvider.forceFlush();
    expect(operationCount("tools/list")).toBe(before + 1);
    await handler.close();
  });

  test("tracks stdio rejection, acknowledgement, cancellation, and reused ids exactly once", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("stdio");
    const beforeCancelled = subscriptionDurationCount("cancelled", "stdio");
    const beforeCompleted = subscriptionDurationCount("completed", "stdio");
    const wire = new ControlledTransport();
    const handle = serveStdio(
      (requestContext) =>
        new InstrumentedMcpServer(
          { name: "subscription-stdio-test", version: "1.0.0" },
          {},
          requestContext
        ),
      { maxSubscriptions: 1, transport: instrumentStdioTransport(wire) }
    );
    await eventually(() => expect(wire.onmessage).toBeTypeOf("function"));

    wire.receive({
      jsonrpc: "2.0",
      id: 110,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    await eventually(() =>
      expect(wire.sent.some((message) => "id" in message && message.id === 110)).toBe(true)
    );

    wire.receive(modernListenRequest("reused", null));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "id" in message &&
            message.id === "reused" &&
            "error" in message &&
            message.error.code === -32602
        )
      ).toBe(true)
    );
    wire.receive(modernListenRequest("reused"));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "method" in message && message.method === "notifications/subscriptions/acknowledged"
        )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    wire.receive(modernListenRequest("capacity"));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "id" in message &&
            message.id === "capacity" &&
            "error" in message &&
            message.error.code === -32603
        )
      ).toBe(true)
    );
    wire.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "unknown" },
    });
    wire.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "reused" },
    });
    await metricProvider.forceFlush();
    await tracerProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("cancelled", "stdio")).toBe(beforeCancelled + 1);
    expect(
      spanExporter.getFinishedSpans().filter((span) => span.name === "notifications/cancelled")
    ).toHaveLength(2);

    wire.receive(modernListenRequest("reused"));
    await eventually(() =>
      expect(
        wire.sent.filter(
          (message) =>
            "method" in message && message.method === "notifications/subscriptions/acknowledged"
        )
      ).toHaveLength(2)
    );
    await handle.close();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("completed", "stdio")).toBe(beforeCompleted + 1);
  });

  test("does not carry a pre-rejection cancellation into a reused stdio request id", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("stdio");
    const beforeCompleted = subscriptionDurationCount("completed", "stdio");
    const wire = new ControlledTransport();
    const handle = serveStdio(
      (requestContext) =>
        new InstrumentedMcpServer(
          { name: "subscription-reuse-regression-test", version: "1.0.0" },
          {},
          requestContext
        ),
      { transport: instrumentStdioTransport(wire) }
    );
    await eventually(() => expect(wire.onmessage).toBeTypeOf("function"));
    wire.receive({
      jsonrpc: "2.0",
      id: 115,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    await eventually(() =>
      expect(wire.sent.some((message) => "id" in message && message.id === 115)).toBe(true)
    );

    wire.receive(modernListenRequest("retry-after-rejection", null));
    wire.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: "retry-after-rejection" },
    });
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "id" in message &&
            message.id === "retry-after-rejection" &&
            "error" in message &&
            message.error.code === -32602
        )
      ).toBe(true)
    );

    wire.receive(modernListenRequest("retry-after-rejection"));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "method" in message && message.method === "notifications/subscriptions/acknowledged"
        )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    await handle.close();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("completed", "stdio")).toBe(beforeCompleted + 1);
  });

  test("keeps the accepted stdio resource active when only acknowledgement send fails", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("stdio");
    const beforeCompleted = subscriptionDurationCount("completed", "stdio");
    const wire = new ControlledTransport();
    const handle = serveStdio(
      (requestContext) =>
        new InstrumentedMcpServer(
          { name: "subscription-send-failure-test", version: "1.0.0" },
          {},
          requestContext
        ),
      { transport: instrumentStdioTransport(wire) }
    );
    await eventually(() => expect(wire.onmessage).toBeTypeOf("function"));
    wire.receive({
      jsonrpc: "2.0",
      id: 120,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    await eventually(() =>
      expect(wire.sent.some((message) => "id" in message && message.id === 120)).toBe(true)
    );
    wire.sendOperation = async (message) => {
      if ("method" in message && message.method === "notifications/subscriptions/acknowledged") {
        throw new Error("ack write failed");
      }
    };

    wire.receive(modernListenRequest(121));
    await eventually(() =>
      expect(
        spanExporter
          .getFinishedSpans()
          .some(
            (span) =>
              span.name === "subscriptions/listen" &&
              span.attributes["error.type"] === "transport_error"
          )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);
    await handle.close();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("completed", "stdio")).toBe(beforeCompleted + 1);
  });

  test("honors cancellation received while the stdio acknowledgement write is pending", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("stdio");
    const beforeCancelled = subscriptionDurationCount("cancelled", "stdio");
    const wire = new ControlledTransport();
    const handle = serveStdio(
      (requestContext) =>
        new InstrumentedMcpServer(
          { name: "subscription-deferred-ack-test", version: "1.0.0" },
          {},
          requestContext
        ),
      { transport: instrumentStdioTransport(wire) }
    );
    await eventually(() => expect(wire.onmessage).toBeTypeOf("function"));
    wire.receive({
      jsonrpc: "2.0",
      id: 130,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    await eventually(() =>
      expect(wire.sent.some((message) => "id" in message && message.id === 130)).toBe(true)
    );

    const acknowledgementWrite = deferred<void>();
    wire.sendOperation = (message) =>
      "method" in message && message.method === "notifications/subscriptions/acknowledged"
        ? acknowledgementWrite.promise
        : Promise.resolve();
    wire.receive(modernListenRequest(131));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "method" in message && message.method === "notifications/subscriptions/acknowledged"
        )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    wire.receive({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 131 },
    });
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    acknowledgementWrite.resolve(undefined);
    await eventually(() => {
      expect(
        spanExporter
          .getFinishedSpans()
          .some(
            (span) =>
              span.name === "subscriptions/listen" &&
              span.attributes["jsonrpc.request.id"] === "131"
          )
      ).toBe(true);
    });
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("cancelled", "stdio")).toBe(beforeCancelled + 1);
    await handle.close();
  });

  test("completes once when acknowledgement and terminal writes overlap shutdown", async () => {
    await metricProvider.forceFlush();
    const beforeActive = activeSubscriptionCount("stdio");
    const beforeCompleted = subscriptionDurationCount("completed", "stdio");
    const beforeConnectionClosed = subscriptionDurationCount("connection_closed", "stdio");
    const wire = new ControlledTransport();
    const handle = serveStdio(
      (requestContext) =>
        new InstrumentedMcpServer(
          { name: "subscription-deferred-terminal-test", version: "1.0.0" },
          {},
          requestContext
        ),
      { transport: instrumentStdioTransport(wire) }
    );
    await eventually(() => expect(wire.onmessage).toBeTypeOf("function"));
    wire.receive({
      jsonrpc: "2.0",
      id: 140,
      method: "server/discover",
      params: {
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_MCP_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    });
    await eventually(() =>
      expect(wire.sent.some((message) => "id" in message && message.id === 140)).toBe(true)
    );

    const acknowledgementWrite = deferred<void>();
    wire.sendOperation = (message) =>
      "method" in message && message.method === "notifications/subscriptions/acknowledged"
        ? acknowledgementWrite.promise
        : Promise.resolve();
    wire.receive(modernListenRequest(141));
    await eventually(() =>
      expect(
        wire.sent.some(
          (message) =>
            "method" in message && message.method === "notifications/subscriptions/acknowledged"
        )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    const terminalWrite = deferred<void>();
    wire.sendOperation = (message) =>
      "id" in message && message.id === 141 && "result" in message
        ? terminalWrite.promise
        : Promise.resolve();
    const closePromise = handle.close();
    await eventually(() =>
      expect(
        wire.sent.some((message) => "id" in message && message.id === 141 && "result" in message)
      ).toBe(true)
    );

    wire.triggerClose();
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    acknowledgementWrite.resolve(undefined);
    await eventually(() =>
      expect(
        spanExporter
          .getFinishedSpans()
          .some(
            (span) =>
              span.name === "subscriptions/listen" &&
              span.attributes["jsonrpc.request.id"] === "141"
          )
      ).toBe(true)
    );
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive + 1);

    terminalWrite.resolve(undefined);
    await closePromise;
    await metricProvider.forceFlush();
    expect(activeSubscriptionCount("stdio")).toBe(beforeActive);
    expect(subscriptionDurationCount("completed", "stdio")).toBe(beforeCompleted + 1);
    expect(subscriptionDurationCount("connection_closed", "stdio")).toBe(beforeConnectionClosed);
  });
});
