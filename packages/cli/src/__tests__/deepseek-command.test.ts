import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const writeDeepSeekCredential = vi.fn();
const installDeepSeekPlugin = vi.fn();
const validateDeepSeekProfile = vi.fn((profile: string) => profile);
const trackEvent = vi.fn();

vi.mock("../setup/deepseek.js", () => ({
  writeDeepSeekCredential: (...args: unknown[]) => writeDeepSeekCredential(...args),
  installDeepSeekPlugin: (...args: unknown[]) => installDeepSeekPlugin(...args),
  validateDeepSeekProfile: (...args: [string]) => validateDeepSeekProfile(...args),
}));

vi.mock("../utils/tracking.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const spinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
};

vi.mock("ora", () => ({ default: () => spinner }));

import { registerSetupCommand } from "../commands/setup.js";

async function runSetup(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSetupCommand(program);
  await program.parseAsync(["node", "test", "setup", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  writeDeepSeekCredential.mockResolvedValue("/tmp/dsh/.credentials.yaml");
  installDeepSeekPlugin.mockResolvedValue(undefined);
  validateDeepSeekProfile.mockImplementation((profile: string) => profile);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("DeepSeek Harness setup command", () => {
  test("stores the credential and installs the requested profile", async () => {
    await runSetup("--deepseek", "team", "--api-key", "ctx7sk-test");

    expect(writeDeepSeekCredential).toHaveBeenCalledWith("ctx7sk-test");
    expect(installDeepSeekPlugin).toHaveBeenCalledWith("team");
    expect(trackEvent).toHaveBeenCalledWith("setup", { mode: "deepseek", profile: "team" });
    expect(process.exitCode).toBeUndefined();
  });

  test("uses the headless profile by default", async () => {
    await runSetup("--deepseek", "--api-key", "ctx7sk-test");

    expect(installDeepSeekPlugin).toHaveBeenCalledWith("headless");
  });

  test("rejects incompatible setup modes", async () => {
    await runSetup("--deepseek", "--mcp", "--api-key", "ctx7sk-test");

    expect(writeDeepSeekCredential).not.toHaveBeenCalled();
    expect(installDeepSeekPlugin).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("validates the profile before storing a credential", async () => {
    validateDeepSeekProfile.mockImplementation(() => {
      throw new Error("Invalid DeepSeek Harness profile name");
    });

    await runSetup("--deepseek", "..", "--api-key", "ctx7sk-test");

    expect(writeDeepSeekCredential).not.toHaveBeenCalled();
    expect(installDeepSeekPlugin).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("fails when the credential cannot be written", async () => {
    writeDeepSeekCredential.mockRejectedValue(new Error("write failed"));

    await runSetup("--deepseek", "--api-key", "ctx7sk-test");

    expect(installDeepSeekPlugin).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test("fails when the plugin cannot be installed", async () => {
    installDeepSeekPlugin.mockRejectedValue(new Error("install failed"));

    await runSetup("--deepseek", "--api-key", "ctx7sk-test");

    expect(writeDeepSeekCredential).toHaveBeenCalledWith("ctx7sk-test");
    expect(process.exitCode).toBe(1);
  });
});
