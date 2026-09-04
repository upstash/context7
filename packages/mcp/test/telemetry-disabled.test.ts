import { afterAll, beforeAll, expect, test } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

const previousDisabled = process.env.OTEL_SDK_DISABLED;
process.env.OTEL_SDK_DISABLED = "true";
const {
  forceFlushTelemetry,
  initializeTelemetry,
  observeAuthentication,
  recordToolCallOutcome,
  observeUpstreamRequest,
} = await import("../src/lib/telemetry-runtime.js");

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const provider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    }),
  ],
});

beforeAll(() => {
  expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
});

afterAll(async () => {
  await provider.shutdown();
  metrics.disable();
  if (previousDisabled === undefined) delete process.env.OTEL_SDK_DISABLED;
  else process.env.OTEL_SDK_DISABLED = previousDisabled;
});

test("OTEL_SDK_DISABLED bypasses all application metric instruments", async () => {
  await expect(
    initializeTelemetry({ allowEmbeddedPrometheus: true, serviceVersion: "test" })
  ).resolves.toBeUndefined();
  expect(() => recordToolCallOutcome("success")).not.toThrow();
  await expect(
    observeUpstreamRequest(
      "fetch_context",
      async () => new Response("ok"),
      async (response) => response.text()
    )
  ).resolves.toBe("ok");
  await expect(
    observeAuthentication(async () => ({ outcome: "accepted", value: "auth" }))
  ).resolves.toBe("auth");
  await forceFlushTelemetry();
  await provider.forceFlush();

  const metricNames = exporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .map((metric) => metric.descriptor.name);
  expect(metricNames).toEqual([]);
});
