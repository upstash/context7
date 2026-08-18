import { metrics, type Attributes } from "@opentelemetry/api";
import { markCurrentMcpOperationError, markCurrentMcpToolOutcome } from "./mcp-operation-scope.js";
import { telemetryIsDisabled } from "./telemetry-config.js";
import type { ToolCallOutcome } from "./tool-names.js";

const METER_NAME = "io.github.upstash.context7.mcp";
const SHUTDOWN_METRIC_FLUSH_TIMEOUT_MS = 4_000;
const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
const TELEMETRY_DISABLED = telemetryIsDisabled();
const TIMEOUT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);
const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
]);

export type UpstreamOperation = "fetch_context" | "oauth_metadata" | "search_libraries";
export type AuthenticationOutcome = "accepted" | "error" | "invalid" | "missing";
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

export interface UpstreamObservationOptions {
  abortSignal?: AbortSignal;
}

function createInstruments() {
  const meter = metrics.getMeter(METER_NAME);
  return {
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
  let timeout = false;
  let cancelled = false;
  let networkError = false;
  const rootCount = abortSignal?.aborted ? 2 : 1;

  for (let rootIndex = 0; rootIndex < rootCount; rootIndex += 1) {
    let value = rootIndex === 0 ? error : abortSignal?.reason;
    for (let depth = 0; value && typeof value === "object" && depth < 8; depth += 1) {
      const current = value as { cause?: unknown; code?: unknown; name?: unknown };
      const name = current.name;
      const code = current.code;
      if (name === "TimeoutError" || (typeof code === "string" && TIMEOUT_ERROR_CODES.has(code))) {
        timeout = true;
      } else if (name === "AbortError" || code === "ABORT_ERR") {
        cancelled = true;
      } else if (
        typeof code === "string" &&
        (code.startsWith("UND_ERR_") || NETWORK_ERROR_CODES.has(code))
      ) {
        networkError = true;
      }
      value = current.cause;
    }
  }

  if (timeout) return "timeout";
  if (cancelled || abortSignal?.aborted) return "cancelled";
  if (networkError) return "network_error";
  return fallback;
}

export function recordToolCallOutcome(outcome: ToolCallOutcome): void {
  if (TELEMETRY_DISABLED) return;
  if (outcome === "error") markCurrentMcpOperationError();
  markCurrentMcpToolOutcome(outcome);
}

export async function observeUpstreamRequest<T>(
  operationName: UpstreamOperation,
  request: () => Promise<Response>,
  consumeResponse: (response: Response) => Promise<T>,
  options: UpstreamObservationOptions = {}
): Promise<T> {
  if (TELEMETRY_DISABLED) return consumeResponse(await request());

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
  if (TELEMETRY_DISABLED) return;

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
  if (TELEMETRY_DISABLED) return (await operation()).value;

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
