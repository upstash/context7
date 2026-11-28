import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { ServerContext } from "@modelcontextprotocol/server";
import { skillEntry, type SkillResourceEntry } from "@modelcontextprotocol/server/ext/skills";

const CTX = {} as ServerContext;
const GUIDE_MD = "---\nname: team-guide\ndescription: How the team ships.\n---\n# Team guide\n";
const GUIDE = await skillEntry("team-guide", { "SKILL.md": GUIDE_MD });
const GUIDE_FILES = GUIDE.resources as SkillResourceEntry[];

// team_a has one skill; every other caller has none.
vi.mock("../src/lib/team-skills-snapshot.js", () => ({
  teamSkillsFor: (teamspaceId: string | undefined) =>
    teamspaceId === "team_a"
      ? {
          teamspaceId,
          skills: [GUIDE],
          entries: new Map([[GUIDE.uri, GUIDE]]),
          files: new Map(GUIDE_FILES.map((file) => [file.uri, file])),
        }
      : undefined,
  fetchTeamSkillFile: async () => new TextEncoder().encode(GUIDE_MD),
}));

const { initializeTelemetry } = await import("../src/lib/telemetry-runtime.js");
const { skillSource } = await import("../src/lib/skills.js");

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const provider = new MeterProvider({
  readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
});

beforeAll(async () => {
  expect(metrics.setGlobalMeterProvider(provider)).toBe(true);
  await initializeTelemetry({ allowEmbeddedPrometheus: false, serviceVersion: "test" });
});

afterAll(async () => {
  await provider.shutdown();
  metrics.disable();
});

/** context7.mcp.team_skills.calls by its call label. */
async function teamSkillCalls(): Promise<Record<string, number>> {
  await provider.forceFlush();
  const metric = exporter
    .getMetrics()
    .at(-1)
    ?.scopeMetrics.flatMap((scope) => scope.metrics)
    .find((candidate) => candidate.descriptor.name === "context7.mcp.team_skills.calls");
  if (!metric || metric.dataPointType !== DataPointType.SUM) return {};
  return Object.fromEntries(
    metric.dataPoints.map((point) => [point.attributes["context7.team_skill.call"], point.value])
  );
}

test("counts team skill lists, loads and file reads, and nothing for context7-mcp", async () => {
  const team = skillSource("team_a");
  await team.list({}, CTX);
  expect(await team.get(GUIDE.uri, CTX)).toEqual(GUIDE);
  expect(await team.read(GUIDE.uri, CTX)).toMatchObject({ text: GUIDE_MD });

  // The skill everyone gets, and a caller without a teamspace, are not team skill calls.
  await team.get("skill://context7-mcp/SKILL.md", CTX);
  await team.read("skill://context7-mcp/SKILL.md", CTX);
  await skillSource(undefined).list({}, CTX);
  expect(await skillSource("team_b").get(GUIDE.uri, CTX)).toBeUndefined();

  expect(await teamSkillCalls()).toEqual({ list: 1, get: 1, read: 1 });
});
