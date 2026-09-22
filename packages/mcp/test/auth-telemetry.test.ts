import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  forceFlushTelemetry,
  observeAuthentication,
  recordAuthenticationEvent,
} from "../src/lib/telemetry.js";

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

beforeEach(() => {
  exporter.reset();
});

afterAll(async () => {
  await provider.shutdown();
  metrics.disable();
});

function authenticationEvents() {
  const metric = exporter
    .getMetrics()
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === "context7.mcp.authentication.events");
  if (!metric || metric.dataPointType !== DataPointType.SUM) return [];
  return metric.dataPoints;
}

describe("MCP authentication OpenTelemetry", () => {
  test("records authentication decisions with bounded migration attributes", async () => {
    await expect(
      observeAuthentication({ enforcementMode: "required", route: "anonymous" }, async () => ({
        event: "challenge_issued",
        method: "none",
        outcome: "missing",
        value: "denied",
      }))
    ).resolves.toBe("denied");
    await forceFlushTelemetry();

    expect(authenticationEvents()).toContainEqual(
      expect.objectContaining({
        attributes: {
          "context7.authentication.enforcement": "required",
          "context7.authentication.event": "challenge_issued",
          "context7.authentication.method": "none",
          "context7.authentication.outcome": "missing",
          "context7.mcp.route": "anonymous",
        },
        value: 1,
      })
    );
  });

  test("records lifecycle events on the same meter", async () => {
    recordAuthenticationEvent({
      enforcementMode: "required",
      event: "authenticated_tool_call",
      method: "oauth",
      outcome: "accepted",
      route: "anonymous",
    });
    await forceFlushTelemetry();

    expect(authenticationEvents()).toContainEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "context7.authentication.event": "authenticated_tool_call",
          "context7.authentication.method": "oauth",
        }),
        value: 1,
      })
    );
  });
});
