import { metrics } from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { embeddedPrometheusIsEnabled } from "./telemetry-config.js";

const DEFAULT_PROMETHEUS_HOST = "0.0.0.0";
const DEFAULT_PROMETHEUS_PORT = 9464;

let embeddedRuntimeInstrumentation: RuntimeNodeInstrumentation | undefined;

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
 * Installs the embedded Prometheus MetricReader for HTTP serving. A provider
 * installed by an OpenTelemetry preload script wins, so no second SDK is
 * installed. This module is dynamically imported only when the embedded
 * exporter is enabled; stdio and SDK-disabled processes never load it.
 */
export async function startPrometheusMetrics(
  serviceVersion: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<MeterProvider | undefined> {
  if (!embeddedPrometheusIsEnabled(environment)) return undefined;

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
