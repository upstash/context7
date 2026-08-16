import { metrics, type Attributes } from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { markCurrentMcpOperationError } from "./mcp-telemetry.js";

const METER_NAME = "io.github.upstash.context7.mcp";
const DEFAULT_PROMETHEUS_HOST = "0.0.0.0";
const DEFAULT_PROMETHEUS_PORT = 9464;
const SHUTDOWN_METRIC_FLUSH_TIMEOUT_MS = 4_000;
const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export type McpTool = "query-docs" | "resolve-library-id";
export type UpstreamOperation = "fetch_context" | "oauth_metadata" | "search_libraries";
export type AuthenticationOutcome = "accepted" | "error" | "invalid" | "missing";
export type ToolCallOutcome = "error" | "not_found" | "success";
export type UpstreamOutcome =
  | "cancelled"
  | "http_error"
  | "network_error"
  | "response_error"
  | "success"
  | "timeout";

export interface ObservedAuthentication<T> {
  outcome: AuthenticationOutcome;
  value: T;
}

export interface ObservedToolCall<T> {
  outcome: ToolCallOutcome;
  value: T;
}

export interface UpstreamObservationOptions {
  abortSignal?: AbortSignal;
}

function createInstruments() {
  const meter = metrics.getMeter(METER_NAME);
  return {
    toolCalls: meter.createCounter("context7.mcp.tool.calls", {
      description: "Number of MCP tool calls handled",
      unit: "{call}",
    }),
    toolCallDuration: meter.createHistogram("context7.mcp.tool.call.duration", {
      description: "Duration of MCP tool calls",
      unit: "s",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    }),
    activeToolCalls: meter.createUpDownCounter("context7.mcp.tool.calls.active", {
      description: "Number of MCP tool calls currently being handled",
      unit: "{call}",
    }),
    upstreamRequests: meter.createCounter("context7.mcp.upstream.requests", {
      description: "Number of requests made to Context7 dependencies",
      unit: "{request}",
    }),
    upstreamRequestDuration: meter.createHistogram("context7.mcp.upstream.request.duration", {
      description: "Duration of requests made to Context7 dependencies",
      unit: "s",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    }),
    activeUpstreamRequests: meter.createUpDownCounter("context7.mcp.upstream.requests.active", {
      description: "Number of requests to Context7 dependencies currently in flight",
      unit: "{request}",
    }),
    authenticationAttempts: meter.createCounter("context7.mcp.authentication.attempts", {
      description: "Number of authentication attempts on the OAuth-protected MCP endpoint",
      unit: "{attempt}",
    }),
    authenticationDuration: meter.createHistogram("context7.mcp.authentication.duration", {
      description: "Duration of authentication on the OAuth-protected MCP endpoint",
      unit: "s",
      advice: { explicitBucketBoundaries: DURATION_BUCKETS_SECONDS },
    }),
    activeAuthentications: meter.createUpDownCounter("context7.mcp.authentication.active", {
      description: "Number of OAuth-protected MCP requests currently authenticating",
      unit: "{request}",
    }),
  };
}

let instruments: ReturnType<typeof createInstruments> | undefined;
let embeddedRuntimeInstrumentation: RuntimeNodeInstrumentation | undefined;

function getInstruments(): ReturnType<typeof createInstruments> {
  instruments ??= createInstruments();
  return instruments;
}

function elapsedSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1_000;
}

function statusClass(statusCode: number): string {
  if (statusCode >= 100 && statusCode <= 599) {
    return `${Math.floor(statusCode / 100)}xx`;
  }
  return "unknown";
}

export function classifyUpstreamError(
  error: unknown,
  abortSignal?: AbortSignal,
  fallback: "network_error" | "response_error" = "network_error"
): "cancelled" | "network_error" | "response_error" | "timeout" {
  const values: unknown[] = [error];
  if (abortSignal?.aborted) values.push(abortSignal.reason);

  const chain: Array<{ code?: unknown; name?: unknown }> = [];
  const seen = new Set<unknown>();
  for (let value of values) {
    for (let depth = 0; value && typeof value === "object" && depth < 8; depth += 1) {
      if (seen.has(value)) break;
      seen.add(value);
      chain.push(value as { code?: unknown; name?: unknown });
      value = (value as { cause?: unknown }).cause;
    }
  }

  const names = chain.map((value) => value.name).filter((value) => typeof value === "string");
  const codes = chain.map((value) => value.code).filter((value) => typeof value === "string");
  if (
    names.includes("TimeoutError") ||
    codes.some((code) =>
      [
        "ETIMEDOUT",
        "UND_ERR_BODY_TIMEOUT",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
      ].includes(code)
    )
  ) {
    return "timeout";
  }
  if (names.includes("AbortError") || codes.includes("ABORT_ERR") || abortSignal?.aborted) {
    return "cancelled";
  }
  if (
    codes.some(
      (code) =>
        code.startsWith("UND_ERR_") ||
        [
          "EAI_AGAIN",
          "ECONNREFUSED",
          "ECONNRESET",
          "EHOSTUNREACH",
          "ENETUNREACH",
          "ENOTFOUND",
          "EPIPE",
        ].includes(code)
    )
  ) {
    return "network_error";
  }
  return fallback;
}

export async function observeToolCall<T>(
  tool: McpTool,
  operation: () => Promise<ObservedToolCall<T>>
): Promise<T> {
  const { activeToolCalls, toolCallDuration, toolCalls } = getInstruments();
  const activeAttributes: Attributes = { "mcp.tool.name": tool };
  const startedAt = performance.now();
  let outcome: ToolCallOutcome = "error";
  activeToolCalls.add(1, activeAttributes);

  try {
    const observed = await operation();
    outcome = observed.outcome;
    return observed.value;
  } finally {
    if (outcome === "error") markCurrentMcpOperationError();
    const attributes = { ...activeAttributes, "mcp.tool.outcome": outcome };
    activeToolCalls.add(-1, activeAttributes);
    toolCalls.add(1, attributes);
    toolCallDuration.record(elapsedSeconds(startedAt), attributes);
  }
}

export async function observeUpstreamRequest<T>(
  operationName: UpstreamOperation,
  request: () => Promise<Response>,
  consumeResponse: (response: Response) => Promise<T>,
  options: UpstreamObservationOptions = {}
): Promise<T> {
  const { activeUpstreamRequests, upstreamRequestDuration, upstreamRequests } = getInstruments();
  const activeAttributes: Attributes = { "context7.upstream.operation": operationName };
  const startedAt = performance.now();
  let outcome: UpstreamOutcome = "network_error";
  let responseStatus: number | undefined;
  let responseStatusClass = "none";
  activeUpstreamRequests.add(1, activeAttributes);

  try {
    let response: Response;
    try {
      response = await request();
    } catch (error) {
      outcome = classifyUpstreamError(error, options.abortSignal);
      throw error;
    }
    responseStatus = response.status;
    responseStatusClass = statusClass(response.status);
    outcome = response.ok ? "success" : "http_error";
    try {
      return await consumeResponse(response);
    } catch (error) {
      outcome = classifyUpstreamError(error, options.abortSignal, "response_error");
      throw error;
    }
  } finally {
    const attributes: Attributes = {
      ...activeAttributes,
      "http.response.status_code_class": responseStatusClass,
      "context7.upstream.outcome": outcome,
    };
    if (responseStatus !== undefined) {
      attributes["http.response.status_code"] = responseStatus;
    }
    activeUpstreamRequests.add(-1, activeAttributes);
    upstreamRequests.add(1, attributes);
    upstreamRequestDuration.record(elapsedSeconds(startedAt), attributes);
  }
}

export async function forceFlushMetrics(): Promise<void> {
  const provider = metrics.getMeterProvider() as {
    forceFlush?: (options?: { timeoutMillis?: number }) => Promise<void>;
  };
  if (!provider.forceFlush) return;

  try {
    await provider.forceFlush.call(provider, {
      timeoutMillis: SHUTDOWN_METRIC_FLUSH_TIMEOUT_MS,
    });
  } catch (error) {
    console.error("OpenTelemetry metrics failed to flush during shutdown:", error);
  }
}

export async function observeAuthentication<T>(
  operation: () => Promise<ObservedAuthentication<T>>
): Promise<T> {
  const { activeAuthentications, authenticationAttempts, authenticationDuration } =
    getInstruments();
  const activeAttributes: Attributes = { "context7.mcp.route": "oauth" };
  const startedAt = performance.now();
  let outcome: AuthenticationOutcome = "error";
  activeAuthentications.add(1, activeAttributes);

  try {
    const observed = await operation();
    outcome = observed.outcome;
    return observed.value;
  } finally {
    const attributes = { "context7.authentication.outcome": outcome };
    activeAuthentications.add(-1, activeAttributes);
    authenticationAttempts.add(1, attributes);
    authenticationDuration.record(elapsedSeconds(startedAt), attributes);
  }
}

function prometheusIsEnabled(environment: NodeJS.ProcessEnv): boolean {
  if (environment.OTEL_SDK_DISABLED?.toLowerCase() === "true") return false;

  const configuredExporters = environment.OTEL_METRICS_EXPORTER;
  if (!configuredExporters) return true;

  return configuredExporters
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes("prometheus");
}

function prometheusPort(environment: NodeJS.ProcessEnv): number {
  const configuredPort = environment.OTEL_EXPORTER_PROMETHEUS_PORT;
  if (!configuredPort) return DEFAULT_PROMETHEUS_PORT;

  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid OTEL_EXPORTER_PROMETHEUS_PORT: '${configuredPort}'`);
  }
  return port;
}

/**
 * Installs the embedded Prometheus MetricReader for the HTTP server. A provider
 * installed by an OpenTelemetry preload script wins; in that case the
 * instruments above continue reporting to that provider and no second SDK is
 * installed. Stdio mode never calls this function, so local MCP processes do
 * not contend for a metrics port.
 */
export async function startPrometheusMetrics(
  serviceVersion: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<MeterProvider | undefined> {
  if (!prometheusIsEnabled(environment)) return undefined;

  let provider: MeterProvider | undefined;
  let providerWasRegistered = false;
  try {
    const host = environment.OTEL_EXPORTER_PROMETHEUS_HOST || DEFAULT_PROMETHEUS_HOST;
    const port = prometheusPort(environment);
    const exporter = new PrometheusExporter({ host, port, preventServerStart: true });
    provider = new MeterProvider({
      resource: defaultResource().merge(
        resourceFromAttributes({
          "service.name": "context7-mcp",
          "service.version": serviceVersion,
        })
      ),
      readers: [exporter],
    });

    providerWasRegistered = metrics.setGlobalMeterProvider(provider);
    if (!providerWasRegistered) {
      await provider.shutdown();
      console.error(
        "Embedded Prometheus exporter not started because a global OpenTelemetry MeterProvider is already registered"
      );
      return undefined;
    }

    await exporter.startServer();
    try {
      // Keep the native 10 ms precision. The same setting controls the
      // monitorEventLoopDelay resolution, so increasing it to the scrape
      // interval would make healthy delay percentiles appear artificially high.
      embeddedRuntimeInstrumentation = new RuntimeNodeInstrumentation();
      embeddedRuntimeInstrumentation.setMeterProvider(provider);
      embeddedRuntimeInstrumentation.enable();
    } catch (error) {
      // Application metrics remain useful if a particular Node runtime cannot
      // provide one of the optional process-level collectors.
      embeddedRuntimeInstrumentation?.disable();
      embeddedRuntimeInstrumentation = undefined;
      console.error("OpenTelemetry Node runtime metrics failed to start:", error);
    }
    console.error(`OpenTelemetry metrics available at http://${host}:${port}/metrics`);
    return provider;
  } catch (error) {
    if (providerWasRegistered) metrics.disable();
    await provider?.shutdown().catch(() => undefined);
    console.error(
      "Embedded Prometheus exporter failed to start; MCP serving will continue:",
      error
    );
    return undefined;
  }
}
