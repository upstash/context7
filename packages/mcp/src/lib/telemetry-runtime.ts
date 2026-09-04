import type {
  McpHttpHandler,
  McpRequestContext,
  McpServer,
  Implementation,
  ServerOptions,
  Transport,
} from "@modelcontextprotocol/server";
import type {
  ObservedAuthentication,
  UpstreamObservationOptions,
  UpstreamOperation,
} from "./telemetry-contracts.js";
import { embeddedPrometheusIsEnabled, telemetryIsDisabled } from "./telemetry-config.js";
import type { ToolCallOutcome } from "./tool-names.js";

interface TelemetryStartupOptions {
  allowEmbeddedPrometheus: boolean;
  serviceVersion: string;
}

interface McpInstrumentation {
  createServer(
    serverInfo: Implementation,
    serverOptions: ServerOptions,
    requestContext: McpRequestContext
  ): McpServer;
  instrumentHttpHandler(handler: McpHttpHandler): McpHttpHandler;
  instrumentStdioTransport(transport: Transport): Transport;
}

type TelemetryImplementation = typeof import("./telemetry.js");
type McpTelemetryImplementation = typeof import("./mcp-telemetry.js");

const TELEMETRY_DISABLED = telemetryIsDisabled();
let implementation: TelemetryImplementation | undefined;
let implementationPromise: Promise<TelemetryImplementation> | undefined;
let mcpImplementationPromise: Promise<McpTelemetryImplementation> | undefined;
let prometheusStartup: Promise<unknown> | undefined;

function loadImplementation(): Promise<TelemetryImplementation> {
  implementationPromise ??= import("./telemetry.js")
    .then((loaded) => {
      implementation = loaded;
      return loaded;
    })
    .catch((error) => {
      implementationPromise = undefined;
      throw error;
    });
  return implementationPromise;
}

function loadMcpImplementation(): Promise<McpTelemetryImplementation> {
  mcpImplementationPromise ??= import("./mcp-telemetry.js").catch((error) => {
    mcpImplementationPromise = undefined;
    throw error;
  });
  return mcpImplementationPromise;
}

async function startEmbeddedPrometheus(serviceVersion: string): Promise<void> {
  prometheusStartup ??= import("./telemetry-provider.js")
    .then(({ startPrometheusMetrics }) => startPrometheusMetrics(serviceVersion))
    .catch((error) => {
      prometheusStartup = undefined;
      throw error;
    });
  await prometheusStartup;
}

export async function initializeTelemetry(
  options: TelemetryStartupOptions
): Promise<McpInstrumentation | undefined> {
  if (TELEMETRY_DISABLED) return undefined;

  const [loadedTelemetry, loadedMcpTelemetry] = await Promise.all([
    loadImplementation(),
    loadMcpImplementation(),
  ]);
  implementation = loadedTelemetry;

  if (options.allowEmbeddedPrometheus && embeddedPrometheusIsEnabled()) {
    await startEmbeddedPrometheus(options.serviceVersion);
  }

  return {
    createServer: (serverInfo, serverOptions, requestContext) =>
      new loadedMcpTelemetry.InstrumentedMcpServer(serverInfo, serverOptions, requestContext),
    instrumentHttpHandler: loadedMcpTelemetry.instrumentMcpHttpHandler,
    instrumentStdioTransport: loadedMcpTelemetry.instrumentStdioTransport,
  };
}

export async function observeAuthentication<T>(
  operation: () => Promise<ObservedAuthentication<T>>
): Promise<T> {
  if (TELEMETRY_DISABLED) return (await operation()).value;
  return (await loadImplementation()).observeAuthentication(operation);
}

export async function observeUpstreamRequest<T>(
  operationName: UpstreamOperation,
  request: () => Promise<Response>,
  consumeResponse: (response: Response) => Promise<T>,
  options: UpstreamObservationOptions = {}
): Promise<T> {
  if (TELEMETRY_DISABLED) return consumeResponse(await request());
  return (await loadImplementation()).observeUpstreamRequest(
    operationName,
    request,
    consumeResponse,
    options
  );
}

export function recordToolCallOutcome(outcome: ToolCallOutcome): void {
  implementation?.recordToolCallOutcome(outcome);
}

export async function forceFlushTelemetry(): Promise<void> {
  await implementation?.forceFlushTelemetry();
}

export type {
  ObservedAuthentication,
  UpstreamObservationOptions,
  UpstreamOperation,
} from "./telemetry-contracts.js";
