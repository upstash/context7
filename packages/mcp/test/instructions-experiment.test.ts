import { createHash } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

const recordInstructionRequest = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/telemetry-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/telemetry-runtime.js")>()),
  recordInstructionRequest,
}));

import { ALWAYS_LOAD_META } from "../src/lib/constants.js";
import {
  createInstructionsExperiment,
  DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT,
  instructionsExperimentConfig,
  instructionsExperimentIdentity,
  LEGACY_SERVER_INSTRUCTIONS,
} from "../src/lib/instructions-experiment.js";
import { SERVER_INSTRUCTIONS } from "../src/lib/server-instructions.js";

const experiment = (controlPercent: number, salt = "test-salt") =>
  createInstructionsExperiment({
    CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: String(controlPercent),
    CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: salt,
  });

beforeEach(() => {
  recordInstructionRequest.mockClear();
});

describe("instructionsExperimentConfig", () => {
  test("is off by default and for invalid values", () => {
    for (const value of [undefined, "", "abc", "-5", "101", "12.5", "1000"]) {
      expect(
        instructionsExperimentConfig({ CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: value })
          .controlPercent
      ).toBe(0);
    }
  });

  test("reads the control share and the salt", () => {
    expect(
      instructionsExperimentConfig({
        CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: " 50 ",
        CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: "round-2",
      })
    ).toEqual({ controlPercent: 50, salt: "round-2" });
    expect(instructionsExperimentConfig({}).salt).toBe(DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT);
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

  test("hashes other tokens and falls back to the client IP", () => {
    expect(instructionsExperimentIdentity({ apiKey: "oat_opaque" })).toMatch(
      /^token:[0-9a-f]{64}$/
    );
    expect(instructionsExperimentIdentity({ apiKey: unsignedJwt({ exp: 1 }) })).toMatch(/^token:/);
    expect(instructionsExperimentIdentity({ clientIp: "10.0.0.9" })).toBe("ip:10.0.0.9");
    expect(instructionsExperimentIdentity({})).toBeUndefined();
  });
});

describe("assign", () => {
  test("assigns nothing while the test is off or without an identity", () => {
    expect(experiment(0).assign({ apiKey: "ctx7sk-a" })).toBeUndefined();
    expect(createInstructionsExperiment({}).assign({ apiKey: "ctx7sk-a" })).toBeUndefined();
    expect(experiment(50).assign({})).toBeUndefined();
  });

  test("keeps a caller in one arm and unit, with the configured percent", () => {
    const half = experiment(50);
    const first = half.assign({ apiKey: "ctx7sk-stable" })!;
    expect(first.unit).toMatch(/^[0-9a-f]{32}$/);
    expect(first.controlPercent).toBe(50);
    for (let i = 0; i < 20; i++) expect(half.assign({ apiKey: "ctx7sk-stable" })).toEqual(first);
    // Another salt is another split.
    expect(experiment(50, "other-salt").assign({ apiKey: "ctx7sk-stable" })!.unit).not.toBe(
      first.unit
    );
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
  const arm = (variant: "control" | "treatment") => ({ variant, unit: "u", controlPercent: 50 });

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
    expect(experiment(0).sessionConfig(undefined)).toEqual({
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
  const arm = { variant: "treatment" as const, unit: "u", controlPercent: 50 };

  test("counts initialize and server/discover with the client name", () => {
    const half = experiment(50);
    half.observeRequest(arm, { method: "initialize", params: { clientInfo: { name: "cursor" } } });
    half.observeRequest(arm, [
      { method: "notifications/initialized" },
      {
        method: "server/discover",
        params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "claude-code" } } },
      },
    ]);
    half.observeRequest(arm, { method: "initialize", params: {} }, "from-user-agent");
    expect(recordInstructionRequest.mock.calls).toEqual([
      ["treatment", "cursor"],
      ["treatment", "claude-code"],
      ["treatment", "from-user-agent"],
    ]);
  });

  test("ignores other requests and callers without an arm", () => {
    const half = experiment(50);
    half.observeRequest(arm, { method: "tools/call", params: { name: "query-docs" } });
    half.observeRequest(undefined, { method: "initialize", params: {} });
    expect(recordInstructionRequest).not.toHaveBeenCalled();
  });
});
