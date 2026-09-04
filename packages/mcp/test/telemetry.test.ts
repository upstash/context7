import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { z } from "zod";
import {
  InstrumentedMcpServer,
  mcpRouteFromUrl,
  mcpTraceCarrier,
  normalizeMcpMethodName,
  normalizeMcpToolName,
} from "../src/lib/mcp-telemetry.js";
import { classifyUpstreamError } from "../src/lib/telemetry.js";
import { embeddedPrometheusIsEnabled, telemetryIsDisabled } from "../src/lib/telemetry-config.js";

const spanExporter = new InMemorySpanExporter();
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  expect(context.setGlobalContextManager(contextManager.enable())).toBe(true);
  expect(trace.setGlobalTracerProvider(tracerProvider)).toBe(true);
  expect(propagation.setGlobalPropagator(new W3CTraceContextPropagator())).toBe(true);
});

afterAll(async () => {
  await tracerProvider.shutdown();
  contextManager.disable();
  context.disable();
  trace.disable();
  propagation.disable();
});

describe("MCP telemetry cardinality", () => {
  test("retains standard MCP methods", () => {
    expect(normalizeMcpMethodName("tools/call")).toBe("tools/call");
    expect(normalizeMcpMethodName("completion/complete")).toBe("completion/complete");
  });

  test("collapses untrusted method names", () => {
    expect(normalizeMcpMethodName("attacker-controlled-method")).toBe("unknown");
    expect(normalizeMcpMethodName(undefined)).toBe("unknown");
  });

  test("retains only registered Context7 tool names", () => {
    expect(normalizeMcpToolName("query-docs")).toBe("query-docs");
    expect(normalizeMcpToolName("resolve-library-id")).toBe("resolve-library-id");
    expect(normalizeMcpToolName("attacker-controlled-tool")).toBe("unknown");
  });

  test("labels both protected Express route spellings as OAuth", () => {
    expect(mcpRouteFromUrl("https://example.com/mcp/oauth")).toBe("oauth");
    expect(mcpRouteFromUrl("https://example.com/mcp/oauth/")).toBe("oauth");
    expect(mcpRouteFromUrl("https://example.com/mcp")).toBe("anonymous");
  });

  test("extracts only SEP-414 trace propagation fields", () => {
    const message: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "query-docs",
        _meta: {
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          tracestate: "vendor=value",
          baggage: "tenant=example",
          apiKey: "must-not-propagate",
        },
      },
    };

    expect(mcpTraceCarrier(message)).toEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
      baggage: "tenant=example",
    });
  });
});

describe("upstream failure classification", () => {
  test("distinguishes timeout, cancellation, and other network failures", () => {
    expect(classifyUpstreamError(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
    expect(classifyUpstreamError(new DOMException("cancelled", "AbortError"))).toBe("cancelled");
    expect(classifyUpstreamError(new TypeError("connection refused"))).toBe("network_error");
  });

  test("finds Undici timeout codes in nested fetch causes", () => {
    const cause = Object.assign(new Error("connect timed out"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const failure = Object.assign(new TypeError("fetch failed"), { cause });
    expect(classifyUpstreamError(failure)).toBe("timeout");
  });

  test("uses abort reasons during response-body consumption", () => {
    const timeout = new AbortController();
    timeout.abort(new DOMException("body timed out", "TimeoutError"));
    expect(
      classifyUpstreamError(
        new DOMException("body aborted", "AbortError"),
        timeout.signal,
        "response_error"
      )
    ).toBe("timeout");

    const cancellation = new AbortController();
    cancellation.abort();
    expect(
      classifyUpstreamError(new Error("body stopped"), cancellation.signal, "response_error")
    ).toBe("cancelled");
    expect(
      classifyUpstreamError(new SyntaxError("invalid JSON"), undefined, "response_error")
    ).toBe("response_error");
  });
});

describe("telemetry configuration", () => {
  test("uses OTEL_SDK_DISABLED as the complete telemetry off switch", () => {
    expect(telemetryIsDisabled({ OTEL_SDK_DISABLED: "TRUE" })).toBe(true);
    expect(telemetryIsDisabled({ OTEL_SDK_DISABLED: " true\n" })).toBe(true);
    expect(embeddedPrometheusIsEnabled({ OTEL_SDK_DISABLED: "true" })).toBe(false);
  });

  test("enables only the configured embedded Prometheus exporter", () => {
    expect(embeddedPrometheusIsEnabled({})).toBe(true);
    expect(embeddedPrometheusIsEnabled({ OTEL_METRICS_EXPORTER: "none" })).toBe(false);
    expect(embeddedPrometheusIsEnabled({ OTEL_METRICS_EXPORTER: "otlp, prometheus" })).toBe(true);
  });
});

describe("MCP trace instrumentation", () => {
  test("creates a semantic server span parented by SEP-414 trace context", async () => {
    const server = new InstrumentedMcpServer(
      { name: "trace-test", version: "1.0.0" },
      { capabilities: { tools: {} } },
      { era: "legacy" }
    );
    server.registerTool(
      "query-docs",
      { description: "trace test tool", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "text", text: "ok" }] })
    );

    const client = new Client({ name: "trace-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const ambientSpan = trace.getTracer("http-test").startSpan("POST /mcp");
      await context.with(trace.setSpan(ROOT_CONTEXT, ambientSpan), () =>
        client.callTool({
          name: "query-docs",
          arguments: {},
          _meta: {
            traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
          },
        })
      );
      ambientSpan.end();
      await tracerProvider.forceFlush();

      const span = spanExporter
        .getFinishedSpans()
        .find((candidate) => candidate.name === "tools/call query-docs");
      expect(span).toBeDefined();
      expect(span?.kind).toBe(SpanKind.SERVER);
      expect(span?.status.code).toBe(SpanStatusCode.UNSET);
      expect(span?.attributes).toMatchObject({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "query-docs",
        "mcp.method.name": "tools/call",
        "network.transport": "pipe",
      });
      expect(span?.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(span?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
      expect(span?.links).toHaveLength(1);
      expect(span?.links[0].context.spanId).toBe(ambientSpan.spanContext().spanId);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
