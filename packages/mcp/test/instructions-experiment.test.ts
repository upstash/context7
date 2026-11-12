import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

const recordInstructionRequest = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/telemetry-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/telemetry-runtime.js")>()),
  recordInstructionRequest,
}));

import { ALWAYS_LOAD_META } from "../src/lib/constants.js";
import {
  anonymousNetwork,
  createInstructionsExperiment,
  instructionsExperimentConfig,
  instructionsExperimentIdentity,
  LEGACY_SERVER_INSTRUCTIONS,
} from "../src/lib/instructions-experiment.js";
import { SERVER_INSTRUCTIONS } from "../src/lib/server-instructions.js";
import type { InstructionsArm } from "../src/lib/types.js";

const env = (controlPercent: string, overrides: Record<string, string | undefined> = {}) => ({
  CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: controlPercent,
  CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID: "instructions-v1",
  CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: "a-secret-salt-of-16+",
  ...overrides,
});
const report = vi.fn();
const reportDefinition = vi.fn(async () => true);
let clock = 0;
const experiment = (controlPercent: number, salt = "a-secret-salt-of-16+") =>
  createInstructionsExperiment(
    env(String(controlPercent), { CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: salt }),
    {
      canSealAssertions: () => true,
      report,
      reportDefinition,
      now: () => clock,
    }
  );

beforeEach(() => {
  recordInstructionRequest.mockClear();
  report.mockClear();
  reportDefinition.mockReset();
  reportDefinition.mockResolvedValue(true);
  clock = 0;
});

describe("instructionsExperimentConfig", () => {
  const sealable = () => true;

  test("is off when the percent is unset, empty or 0", () => {
    for (const value of [undefined, "", " ", "0"]) {
      expect(
        instructionsExperimentConfig({ CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: value }, sealable)
      ).toBeUndefined();
    }
  });

  test("reads the share, the experiment ID and the salt", () => {
    expect(instructionsExperimentConfig(env(" 50 "), sealable)).toEqual({
      controlPercent: 50,
      experimentId: "instructions-v1",
      salt: "a-secret-salt-of-16+",
    });
  });

  test("fails the deploy on an invalid setting instead of rolling out to everyone", () => {
    for (const value of ["abc", "-5", "101", "12.5", "50%"]) {
      expect(() => instructionsExperimentConfig(env(value), sealable)).toThrow(/integer 0-100/);
    }
    expect(() =>
      instructionsExperimentConfig(env("50", { CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID: "" }), sealable)
    ).toThrow(/EXPERIMENT_ID/);
    expect(() =>
      instructionsExperimentConfig(
        env("50", { CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: "short" }),
        sealable
      )
    ).toThrow(/SALT/);
    expect(() => instructionsExperimentConfig(env("50"), () => false)).toThrow(
      /MCP_CLIENT_IP_ASSERTION_KEY/
    );
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
    expect(createInstructionsExperiment({}).assign({ apiKey: "ctx7sk-a" })).toBeUndefined();
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
    // Another salt is another split.
    expect(
      experiment(50, "another-secret-salt").assign({ apiKey: "ctx7sk-stable" })!.unit
    ).not.toBe(first.unit);
  });

  test("marks anonymous callers, and keeps one IPv6 /64 in one unit", () => {
    const half = experiment(50);
    const a = half.assign({ clientIp: "2001:db8:1:2::aaaa" })!;
    const b = half.assign({ clientIp: "2001:db8:1:2::bbbb" })!;
    expect(a.signedIn).toBe(false);
    expect(b.unit).toBe(a.unit);
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
      const split = experiment(controlPercent, "split-check-salt-123");
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
    expect(createInstructionsExperiment({}).sessionConfig(undefined)).toEqual({
      instructions: SERVER_INSTRUCTIONS,
      toolMeta: ALWAYS_LOAD_META,
      privateLists: false,
    });
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
