import { describe, expect, test } from "vitest";
import {
  assignInstructionsVariant,
  DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT,
  instructionsBucket,
  instructionsExperimentConfig,
  instructionsExperimentEnabled,
  instructionsForVariant,
  LEGACY_SERVER_INSTRUCTIONS,
} from "../src/lib/instructions-experiment.js";
import { ALWAYS_LOAD_META, SERVER_INSTRUCTIONS } from "../src/lib/server-instructions.js";

describe("instructionsExperimentConfig", () => {
  test("is off by default and for invalid values", () => {
    for (const value of [undefined, "", "abc", "-5", "101", "12.5", "1000"]) {
      const config = instructionsExperimentConfig({ CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: value });
      expect(config.controlPercent).toBe(0);
      expect(instructionsExperimentEnabled(config)).toBe(false);
    }
  });

  test("reads the control share and the salt", () => {
    const config = instructionsExperimentConfig({
      CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT: " 50 ",
      CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT: "round-2",
    });
    expect(config).toEqual({ controlPercent: 50, salt: "round-2" });
    expect(instructionsExperimentEnabled(config)).toBe(true);
    expect(instructionsExperimentConfig({}).salt).toBe(DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT);
  });
});

describe("assignInstructionsVariant", () => {
  const half = { controlPercent: 50, salt: "test-salt" };

  test("assigns nothing while the test is off", () => {
    expect(
      assignInstructionsVariant({ apiKey: "ctx7sk-a" }, { controlPercent: 0, salt: "s" })
    ).toBeUndefined();
  });

  test("assigns nothing to a caller without an identity", () => {
    expect(assignInstructionsVariant({}, half)).toBeUndefined();
  });

  test("keeps a caller in one arm and changes arms only with the salt", () => {
    const identity = { apiKey: "ctx7sk-stable" };
    const first = assignInstructionsVariant(identity, half);
    for (let i = 0; i < 20; i++) expect(assignInstructionsVariant(identity, half)).toBe(first);
    expect(instructionsBucket("key:ctx7sk-stable", "test-salt")).toBe(
      instructionsBucket("key:ctx7sk-stable", "test-salt")
    );
  });

  test("uses the API key before the client IP", () => {
    // Same key with different IPs must stay in one arm.
    const arms = new Set(
      ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"].map((clientIp) =>
        assignInstructionsVariant({ apiKey: "ctx7sk-roaming", clientIp }, half)
      )
    );
    expect(arms.size).toBe(1);
  });

  test("splits callers close to the control share", () => {
    for (const controlPercent of [10, 50, 90]) {
      const config = { controlPercent, salt: "split-check" };
      let control = 0;
      const total = 20_000;
      for (let i = 0; i < total; i++) {
        if (assignInstructionsVariant({ apiKey: `ctx7sk-user-${i}` }, config) === "control") {
          control++;
        }
      }
      expect(Math.abs((control / total) * 100 - controlPercent)).toBeLessThan(1.5);
    }
  });

  test("puts every caller in control at 100", () => {
    const config = { controlPercent: 100, salt: "s" };
    for (let i = 0; i < 200; i++) {
      expect(assignInstructionsVariant({ clientIp: `10.1.0.${i}` }, config)).toBe("control");
    }
  });
});

describe("instructionsForVariant", () => {
  test("control gets the previous text and no tool meta", () => {
    const control = instructionsForVariant("control");
    expect(control.instructions).toBe(LEGACY_SERVER_INSTRUCTIONS);
    expect(control.toolMeta).toBeUndefined();
  });

  test("treatment and callers without an arm get the current text and alwaysLoad", () => {
    for (const variant of ["treatment", undefined] as const) {
      const arm = instructionsForVariant(variant);
      expect(arm.instructions).toBe(SERVER_INSTRUCTIONS);
      expect(arm.toolMeta).toBe(ALWAYS_LOAD_META);
    }
  });

  test("both texts fit Claude Code's 2048-character limit with room for the preview line", () => {
    expect(LEGACY_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1780);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1780);
    expect(LEGACY_SERVER_INSTRUCTIONS).not.toBe(SERVER_INSTRUCTIONS);
  });
});
