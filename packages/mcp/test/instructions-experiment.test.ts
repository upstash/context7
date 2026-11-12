import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const recordInstructionRequest = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/telemetry-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/telemetry-runtime.js")>()),
  recordInstructionRequest,
}));

import { ALWAYS_LOAD_META } from "../src/lib/constants.js";
import {
  anonymousNetwork,
  createInstructionsExperiment,
  instructionsExperimentIdentity,
  LEGACY_SERVER_INSTRUCTIONS,
  fetchInstructionsExperimentConfig,
  loadInstructionsExperiment,
  parseInstructionsExperimentConfig,
  reportExposure,
} from "../src/lib/instructions-experiment.js";
import { SERVER_INSTRUCTIONS } from "../src/lib/server-instructions.js";
import type { InstructionsArm } from "../src/lib/types.js";

const report = vi.fn();
const reportDefinition = vi.fn(async () => true);
let clock = 0;
const experiment = (controlPercent: number, experimentId: string | null = "instructions-v1") =>
  createInstructionsExperiment(
    { experimentId, controlPercent },
    { report, reportDefinition, now: () => clock }
  );

beforeAll(() => {
  // The arms are an HMAC with the assertion key.
  process.env.MCP_CLIENT_IP_ASSERTION_KEY = "ab".repeat(32);
});
afterAll(() => {
  delete process.env.MCP_CLIENT_IP_ASSERTION_KEY;
});
beforeEach(() => {
  recordInstructionRequest.mockClear();
  report.mockClear();
  reportDefinition.mockReset();
  reportDefinition.mockResolvedValue(true);
  clock = 0;
});

describe("parseInstructionsExperimentConfig", () => {
  test("reads an experiment, or one text for everyone without an ID", () => {
    expect(
      parseInstructionsExperimentConfig({ experimentId: "instructions-v1", controlPercent: 80 })
    ).toEqual({
      experimentId: "instructions-v1",
      controlPercent: 80,
    });
    expect(parseInstructionsExperimentConfig({ experimentId: null, controlPercent: 0 })).toEqual({
      experimentId: null,
      controlPercent: 0,
    });
  });

  test("refuses anything else", () => {
    for (const value of [
      null,
      "80",
      { experimentId: "instructions-v1", controlPercent: 101 },
      { experimentId: "instructions-v1", controlPercent: 12.5 },
      { experimentId: "instructions-v1", controlPercent: "80" },
      { experimentId: "Bad ID", controlPercent: 80 },
      { experimentId: null, controlPercent: 50 },
      { controlPercent: 80 },
    ]) {
      expect(parseInstructionsExperimentConfig(value)).toBeUndefined();
    }
  });
});

describe("fetchInstructionsExperimentConfig", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const withFetch = async (fetchMock: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal("fetch", fetchMock);
    try {
      return await fetchInstructionsExperimentConfig({ retryDelayMs: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  };

  test("reads the config from /v2/mcp/instructions-experiment", async () => {
    const fetchMock = vi.fn(async () =>
      json({ experimentId: "instructions-v1", controlPercent: 80 })
    );
    expect(await withFetch(fetchMock)).toEqual({
      experimentId: "instructions-v1",
      controlPercent: 80,
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(
      /\/v2\/mcp\/instructions-experiment$/
    );
  });

  test("retries a failed request, but not a 404 (no experiment configured)", async () => {
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(json({ experimentId: null, controlPercent: 0 }));
    expect(await withFetch(flaky)).toEqual({ experimentId: null, controlPercent: 0 });
    expect(flaky).toHaveBeenCalledTimes(2);

    const missing = vi.fn(async () => json({ error: "experiment_not_configured" }, 404));
    expect(await withFetch(missing)).toBeUndefined();
    expect(missing).toHaveBeenCalledTimes(1);
  });

  test("gives up after three failures, and refuses an invalid config", async () => {
    const down = vi.fn(async () => json({}, 503));
    expect(await withFetch(down)).toBeUndefined();
    expect(down).toHaveBeenCalledTimes(3);
    expect(
      await withFetch(vi.fn(async () => json({ experimentId: null, controlPercent: 50 })))
    ).toBeUndefined();
  });
});

describe("loadInstructionsExperiment", () => {
  const remote = { CONTEXT7_INSTRUCTIONS_EXPERIMENT: "remote" };
  const arm = (e: Awaited<ReturnType<typeof loadInstructionsExperiment>>) =>
    e.assign({ apiKey: "ctx7sk-load" });

  test("runs no test without the variable, and does not read the config", async () => {
    const fetchConfig = vi.fn();
    const e = await loadInstructionsExperiment({}, { fetchConfig });
    expect(fetchConfig).not.toHaveBeenCalled();
    expect(arm(e)).toBeUndefined();
    expect(e.sessionConfig(undefined).instructions).toBe(SERVER_INSTRUCTIONS);
  });

  test("uses the config the app sent", async () => {
    const e = await loadInstructionsExperiment(remote, {
      fetchConfig: async () => ({ experimentId: "instructions-v1", controlPercent: 80 }),
      canSealAssertions: () => true,
    });
    expect(arm(e)).toMatchObject({ experimentId: "instructions-v1", controlPercent: 80 });
  });

  test("serves the production text to everyone when it gets no config", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await loadInstructionsExperiment(remote, {
      fetchConfig: async () => undefined,
      canSealAssertions: () => true,
    });
    expect(arm(e)).toBeUndefined();
    expect(e.sessionConfig(undefined)).toMatchObject({
      instructions: LEGACY_SERVER_INSTRUCTIONS,
      toolMeta: undefined,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("fails the start on a wrong mode or without the assertion key", async () => {
    await expect(
      loadInstructionsExperiment({ CONTEXT7_INSTRUCTIONS_EXPERIMENT: "on" })
    ).rejects.toThrow(/must be "remote"/);
    await expect(
      loadInstructionsExperiment(remote, { canSealAssertions: () => false })
    ).rejects.toThrow(/MCP_CLIENT_IP_ASSERTION_KEY/);
  });
});

describe("instructionsExperimentIdentity", () => {
  const unsignedJwt = (payload: Record<string, unknown>) =>
    [{ alg: "none", typ: "JWT" }, payload]
      .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
      .join(".") + ".sig";

  test("uses the SHA-256 hex that context7app stores for API keys", () => {
    const apiKey = "ctx7sk-1234";
    const appHash = createHash("sha256").update(apiKey).digest("hex");
    expect(instructionsExperimentIdentity({ apiKey, clientIp: "10.0.0.1" })).toBe(`key:${appHash}`);
  });

  test("uses the JWT subject, so a refreshed token keeps its arm", () => {
    expect(
      instructionsExperimentIdentity({ apiKey: unsignedJwt({ sub: "user_abc", exp: 1 }) })
    ).toBe("user:user_abc");
    expect(
      instructionsExperimentIdentity({ apiKey: unsignedJwt({ sub: "user_abc", exp: 2 }) })
    ).toBe("user:user_abc");
  });

  test("hashes other tokens and falls back to the client network", () => {
    expect(instructionsExperimentIdentity({ apiKey: "oat_opaque" })).toMatch(
      /^token:[0-9a-f]{64}$/
    );
    expect(instructionsExperimentIdentity({ apiKey: unsignedJwt({ exp: 1 }) })).toMatch(/^token:/);
    expect(instructionsExperimentIdentity({ clientIp: "10.0.0.9" })).toBe("ip:10.0.0.9");
    expect(instructionsExperimentIdentity({})).toBeUndefined();
  });
});

describe("anonymousNetwork", () => {
  test("keeps IPv4 and groups IPv6 by /64", () => {
    expect(anonymousNetwork("203.0.113.7")).toBe("203.0.113.7");
    expect(anonymousNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(anonymousNetwork("2001:db8:85a3:12::8a2e:370:7334")).toBe("2001:db8:85a3:12::/64");
    expect(anonymousNetwork("2001:0DB8:85A3:0012:aaaa:bbbb:cccc:dddd")).toBe(
      "2001:db8:85a3:12::/64"
    );
    expect(anonymousNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});

describe("assign", () => {
  test("assigns nothing while the test is off or without an identity", () => {
    expect(createInstructionsExperiment(undefined).assign({ apiKey: "ctx7sk-a" })).toBeUndefined();
    expect(experiment(100, null).assign({ apiKey: "ctx7sk-a" })).toBeUndefined();
    expect(experiment(50).assign({})).toBeUndefined();
  });

  test("keeps a caller in one arm and unit, with the test's ID and share", () => {
    const half = experiment(50);
    const first = half.assign({ apiKey: "ctx7sk-stable" })!;
    expect(first).toMatchObject({
      experimentId: "instructions-v1",
      controlPercent: 50,
      signedIn: true,
    });
    expect(first.unit).toMatch(/^[0-9a-f]{32}$/);
    for (let i = 0; i < 20; i++) expect(half.assign({ apiKey: "ctx7sk-stable" })).toEqual(first);
    // Another experiment is another split.
    expect(experiment(50, "instructions-v2").assign({ apiKey: "ctx7sk-stable" })!.unit).not.toBe(
      first.unit
    );
  });

  test("marks IP and opaque-token callers as not signed in, and keeps one IPv6 /64 in one unit", () => {
    const half = experiment(50);
    const a = half.assign({ clientIp: "2001:db8:1:2::aaaa" })!;
    const b = half.assign({ clientIp: "2001:db8:1:2::bbbb" })!;
    expect(a.signedIn).toBe(false);
    expect(b.unit).toBe(a.unit);
    // An opaque OAuth token changes when it refreshes, so its arm is not stable either.
    expect(half.assign({ apiKey: "oat_opaque" })!.signedIn).toBe(false);
    expect(half.assign({ apiKey: "ctx7sk-a" })!.signedIn).toBe(true);
  });

  test("uses the API key before the client IP", () => {
    const half = experiment(50);
    const units = new Set(
      ["10.0.0.1", "10.0.0.2", "10.0.0.3"].map(
        (clientIp) => half.assign({ apiKey: "ctx7sk-roaming", clientIp })!.unit
      )
    );
    expect(units.size).toBe(1);
  });

  test("splits callers close to the control share", () => {
    for (const controlPercent of [10, 50, 90]) {
      const split = experiment(controlPercent, "split-check");
      const total = 20_000;
      let control = 0;
      for (let i = 0; i < total; i++) {
        if (split.assign({ apiKey: `ctx7sk-user-${i}` })!.variant === "control") control++;
      }
      expect(Math.abs((control / total) * 100 - controlPercent)).toBeLessThan(1.5);
    }
  });

  test("puts every caller in control at 100", () => {
    const all = experiment(100);
    for (let i = 0; i < 200; i++) {
      expect(all.assign({ clientIp: `10.1.0.${i}` })!.variant).toBe("control");
    }
  });
});

describe("sessionConfig", () => {
  const arm = (variant: "control" | "treatment"): InstructionsArm => ({
    experimentId: "instructions-v1",
    variant,
    unit: "u",
    controlPercent: 50,
    signedIn: true,
  });

  test("control gets the previous text, no tool meta, and private lists", () => {
    expect(experiment(50).sessionConfig(arm("control"))).toEqual({
      instructions: LEGACY_SERVER_INSTRUCTIONS,
      toolMeta: undefined,
      privateLists: true,
    });
  });

  test("treatment and callers without an arm get the current text and alwaysLoad", () => {
    expect(experiment(50).sessionConfig(arm("treatment"))).toEqual({
      instructions: SERVER_INSTRUCTIONS,
      toolMeta: ALWAYS_LOAD_META,
      privateLists: true,
    });
    expect(createInstructionsExperiment(undefined).sessionConfig(undefined)).toEqual({
      instructions: SERVER_INSTRUCTIONS,
      toolMeta: ALWAYS_LOAD_META,
      privateLists: false,
    });
  });

  test("without an experiment ID, 100 gives everyone control and 0 treatment, uncounted", () => {
    expect(experiment(100, null).sessionConfig(undefined)).toEqual({
      instructions: LEGACY_SERVER_INSTRUCTIONS,
      toolMeta: undefined,
      privateLists: false,
    });
    expect(experiment(0, null).sessionConfig(undefined).instructions).toBe(SERVER_INSTRUCTIONS);
  });

  test("both texts fit Claude Code's limit with room for the preview line", () => {
    expect(LEGACY_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1780);
    expect(LEGACY_SERVER_INSTRUCTIONS).not.toBe(SERVER_INSTRUCTIONS);
  });
});

describe("observeRequest", () => {
  const arm: InstructionsArm = {
    experimentId: "instructions-v1",
    variant: "treatment",
    unit: "u",
    controlPercent: 50,
    signedIn: true,
  };

  test("counts and reports initialize and server/discover with the client name", () => {
    const half = experiment(50);
    half.observeRequest(
      { arm, clientIp: "203.0.113.1" },
      { method: "initialize", params: { clientInfo: { name: "cursor" } } }
    );
    half.observeRequest({ arm }, [
      { method: "notifications/initialized" },
      {
        method: "server/discover",
        params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "claude-code" } } },
      },
    ]);
    half.observeRequest(
      { arm, fallbackClient: "from-user-agent" },
      { method: "initialize", params: {} }
    );
    expect(recordInstructionRequest.mock.calls).toEqual([
      ["treatment", "cursor"],
      ["treatment", "claude-code"],
      ["treatment", "from-user-agent"],
    ]);
    expect(report.mock.calls.map(([exposure]) => exposure)).toEqual([
      { arm, clientName: "cursor", clientIp: "203.0.113.1" },
      { arm, clientName: "claude-code", clientIp: undefined },
      { arm, clientName: "from-user-agent", clientIp: undefined },
    ]);
  });

  test("ignores other requests and callers without an arm", () => {
    const half = experiment(50);
    half.observeRequest({ arm }, { method: "tools/call", params: { name: "query-docs" } });
    half.observeRequest({ arm: undefined }, { method: "initialize", params: {} });
    expect(recordInstructionRequest).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});

describe("definition report", () => {
  const arm: InstructionsArm = {
    experimentId: "instructions-v1",
    variant: "control",
    unit: "u",
    controlPercent: 50,
    signedIn: true,
  };
  const initialize = { method: "initialize", params: { clientInfo: { name: "cursor" } } };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("sends both arms' prompts once per process, with the first exposure", async () => {
    const half = experiment(50);
    expect(reportDefinition).not.toHaveBeenCalled();
    half.observeRequest({ arm }, initialize);
    await flush();
    half.observeRequest({ arm }, initialize);
    expect(reportDefinition.mock.calls).toEqual([
      [
        {
          experimentId: "instructions-v1",
          controlPercent: 50,
          arms: {
            control: { instructions: LEGACY_SERVER_INSTRUCTIONS, alwaysLoad: false },
            treatment: { instructions: SERVER_INSTRUCTIONS, alwaysLoad: true },
          },
        },
      ],
    ]);
  });

  test("retries a minute after the app did not store it", async () => {
    reportDefinition.mockResolvedValueOnce(false);
    const half = experiment(50);
    half.observeRequest({ arm }, initialize);
    await flush();
    clock = 30_000;
    half.observeRequest({ arm }, initialize);
    expect(reportDefinition).toHaveBeenCalledTimes(1);
    clock = 61_000;
    half.observeRequest({ arm }, initialize);
    expect(reportDefinition).toHaveBeenCalledTimes(2);
  });
});

describe("reportExposure", () => {
  test("sends a caller's client name as a printable ASCII header", () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      reportExposure({
        arm: {
          experimentId: "instructions-v1",
          variant: "treatment",
          unit: "u",
          controlPercent: 50,
          signedIn: true,
        },
        clientName: "Clöde\nCode\u0000 IDE",
        clientIp: undefined,
      });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)["X-Context7-Client-IDE"]).toBe(
        "CldeCode IDE"
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
