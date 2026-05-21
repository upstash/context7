import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { mkdir, rm, realpath } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const trackEvent = vi.fn();
let logOutput: string[];

vi.mock("../utils/tracking.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

import { registerSkillCommands } from "../commands/skill.js";

let tempDir: string;
let originalCwd: string;

async function runCommand(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerSkillCommands(program);
  await program.parseAsync(["node", "test", ...args]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  logOutput = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  const rawTempDir = join(tmpdir(), `ctx7-skills-list-${Date.now()}`);
  await mkdir(rawTempDir, { recursive: true });
  tempDir = await realpath(rawTempDir);
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("skills list command", () => {
  test("outputs installed skills as JSON", async () => {
    await mkdir(join(tempDir, ".agents", "skills", "find-docs"), { recursive: true });
    await mkdir(join(tempDir, ".cursor", "skills", "cursor-helper"), { recursive: true });

    await runCommand("skills", "list", "--json");

    expect(JSON.parse(logOutput.join("\n"))).toEqual({
      skills: [
        {
          name: "find-docs",
          path: join(tempDir, ".agents", "skills", "find-docs"),
          source: "universal",
        },
        {
          name: "cursor-helper",
          path: join(tempDir, ".cursor", "skills", "cursor-helper"),
          source: "cursor",
        },
      ],
    });
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "list" });
  });

  test("outputs an empty JSON list when no skills are installed", async () => {
    await runCommand("skills", "list", "--json");

    expect(JSON.parse(logOutput.join("\n"))).toEqual({ skills: [] });
  });
});
