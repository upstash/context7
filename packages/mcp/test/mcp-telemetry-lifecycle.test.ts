import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  type JSONRPCMessage,
  type MessageExtraInfo,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";
import { SpanStatusCode, propagation, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { InstrumentedMcpServer, classifyServerResponse } from "../src/lib/mcp-telemetry.js";

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
  sendOperation: (message: JSONRPCMessage, options?: TransportSendOptions) => Promise<void> =
    async () => undefined;

  async start(): Promise<void> {}

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.sent.push(message);
    return this.sendOperation(message, options);
  }

  async close(): Promise<void> {
    this.onclose?.();
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

beforeAll(() => {
  expect(trace.setGlobalTracerProvider(tracerProvider)).toBe(true);
});

beforeEach(() => {
  spanExporter.reset();
});

afterAll(async () => {
  await tracerProvider.shutdown();
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

function serverFor(transport: ControlledTransport, requestInfo?: Request): InstrumentedMcpServer {
  const server = new InstrumentedMcpServer(
    { name: "telemetry-lifecycle-test", version: "1.0.0" },
    {},
    { era: "legacy", requestInfo }
  );
  server.server.onerror = () => undefined;
  void server.connect(transport);
  return server;
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
