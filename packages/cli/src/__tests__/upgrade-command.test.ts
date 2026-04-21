import { beforeEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";

const trackEvent = vi.fn();
const checkForUpdates = vi.fn();
const getUpgradePlan = vi.fn();
const markUpdateNotificationShown = vi.fn();
const shouldShowUpdateNotification = vi.fn();
const shouldSkipUpdateNotifier = vi.fn();
const confirm = vi.fn();
const spawn = vi.fn();

vi.mock("../utils/tracking.js", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

vi.mock("../utils/update-check.js", () => ({
  checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
  getUpgradePlan: (...args: unknown[]) => getUpgradePlan(...args),
  markUpdateNotificationShown: (...args: unknown[]) => markUpdateNotificationShown(...args),
  shouldShowUpdateNotification: (...args: unknown[]) => shouldShowUpdateNotification(...args),
  shouldSkipUpdateNotifier: (...args: unknown[]) => shouldSkipUpdateNotifier(...args),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: (...args: unknown[]) => confirm(...args),
}));

vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawn(...args),
}));

import { maybeShowUpgradeNotice, registerUpgradeCommand } from "../commands/upgrade.js";

let logOutput: string[];
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

async function runCommand(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerUpgradeCommand(program);
  await program.parseAsync(["node", "test", ...args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  logOutput = [];
  shouldShowUpdateNotification.mockResolvedValue(true);
  shouldSkipUpdateNotifier.mockReturnValue(false);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(" "));
  });
  spawn.mockReturnValue({
    on: (event: string, handler: (value?: number) => void) => {
      if (event === "close") handler(0);
      return undefined;
    },
  });
});

function plainLogOutput(): string[] {
  return logOutput.map(stripAnsi);
}

describe("upgrade command", () => {
  test("reports when ctx7 is already up to date", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.13",
      updateAvailable: false,
      installMethod: "npm-global",
      upgradePlan: {
        displayCommand: "npm install -g ctx7@latest",
      },
    });

    await runCommand("upgrade");

    expect(plainLogOutput().some((line) => line.includes("ctx7 is up to date"))).toBe(true);
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "upgrade" });
  });

  test("prints upgrade instructions in check mode", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.99",
      updateAvailable: true,
      installMethod: "npm-global",
      upgradePlan: {
        displayCommand: "npm install -g ctx7@latest",
        canRun: true,
        needsExplicitVersion: false,
      },
    });

    await runCommand("upgrade", "--check");

    expect(plainLogOutput().some((line) => line.includes("Update available"))).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("npm install -g ctx7@latest"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("explains ephemeral runners instead of trying to self-upgrade", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.99",
      updateAvailable: true,
      installMethod: "npx",
      upgradePlan: {
        displayCommand: "npx ctx7@latest <command>",
        canRun: false,
        needsExplicitVersion: true,
      },
    });

    await runCommand("upgrade");

    expect(plainLogOutput().some((line) => line.includes("ephemeral runner"))).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("npx ctx7@latest <command>"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  test("runs the upgrade command with --yes when possible", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.99",
      updateAvailable: true,
      installMethod: "npm-global",
      upgradePlan: {
        command: "npm",
        args: ["install", "-g", "ctx7@latest"],
        displayCommand: "npm install -g ctx7@latest",
        canRun: true,
        needsExplicitVersion: false,
      },
    });

    await runCommand("upgrade", "--yes");

    expect(spawn).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "ctx7@latest"],
      expect.objectContaining({ stdio: "inherit" })
    );
  });

  test("falls back to getUpgradePlan when update check fails", async () => {
    checkForUpdates.mockResolvedValue(null);
    getUpgradePlan.mockReturnValue({
      displayCommand: "npm install -g ctx7@latest",
    });

    await runCommand("upgrade", "--check");

    expect(plainLogOutput().some((line) => line.includes("Couldn't check for updates"))).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("npm install -g ctx7@latest"))).toBe(true);
  });

  test("shows retry guidance when the upgrade command fails", async () => {
    spawn.mockReturnValue({
      on: (event: string, handler: (value?: number) => void) => {
        if (event === "close") handler(243);
        return undefined;
      },
    });
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.99",
      updateAvailable: true,
      installMethod: "npm-global",
      upgradePlan: {
        command: "npm",
        args: ["install", "-g", "ctx7@latest"],
        displayCommand: "npm install -g ctx7@latest",
        canRun: true,
        needsExplicitVersion: false,
        installMethod: "npm-global",
      },
    });

    await runCommand("upgrade", "--yes");

    expect(
      plainLogOutput().some((line) => line.includes("Upgrade command exited with code 243"))
    ).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("Try rerunning:"))).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("permissions"))).toBe(true);
  });

  test("shows permissions guidance when install method is unknown but command is global npm", async () => {
    spawn.mockReturnValue({
      on: (event: string, handler: (value?: number) => void) => {
        if (event === "close") handler(243);
        return undefined;
      },
    });
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.13",
      latestVersion: "0.3.99",
      updateAvailable: true,
      installMethod: "unknown",
      upgradePlan: {
        command: "npm",
        args: ["install", "-g", "ctx7@latest"],
        displayCommand: "npm install -g ctx7@latest",
        canRun: false,
        needsExplicitVersion: false,
        installMethod: "unknown",
      },
    });

    await runCommand("upgrade", "--yes");

    expect(spawn).not.toHaveBeenCalled();
    expect(plainLogOutput().some((line) => line.includes("Run npm install -g ctx7@latest"))).toBe(
      true
    );
  });
});

describe("pre-command upgrade notice", () => {
  test("shows a non-blocking notice for upgradeable installs", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.11",
      latestVersion: "0.3.13",
      updateAvailable: true,
      upgradePlan: {
        command: "npm",
        args: ["install", "-g", "ctx7@latest"],
        displayCommand: "npm install -g ctx7@latest",
        canRun: true,
        needsExplicitVersion: false,
      },
    });
    await maybeShowUpgradeNotice({
      actionName: "library",
      argv: ["node", "ctx7", "library", "react"],
      isInteractive: true,
    });

    expect(plainLogOutput().some((line) => line.includes("Update available:"))).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("Run ctx7 upgrade to update now"))).toBe(
      true
    );
    expect(plainLogOutput().some((line) => line.includes("npm install -g ctx7@latest"))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(markUpdateNotificationShown).toHaveBeenCalledWith("0.3.13");
  });

  test("shows guidance-only notice for unknown installs", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.11",
      latestVersion: "0.3.13",
      updateAvailable: true,
      upgradePlan: {
        command: "npm",
        args: ["install", "-g", "ctx7@latest"],
        displayCommand: "npm install -g ctx7@latest",
        canRun: false,
        needsExplicitVersion: false,
      },
    });

    await maybeShowUpgradeNotice({
      actionName: "library",
      argv: ["node", "ctx7", "library", "react"],
      isInteractive: true,
    });

    expect(
      plainLogOutput().some((line) => line.includes("Run ctx7 upgrade for update steps"))
    ).toBe(true);
    expect(plainLogOutput().some((line) => line.includes("npm install -g ctx7@latest"))).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(markUpdateNotificationShown).toHaveBeenCalledWith("0.3.13");
  });

  test("shows runner-specific guidance for ephemeral installs", async () => {
    checkForUpdates.mockResolvedValue({
      currentVersion: "0.3.11",
      latestVersion: "0.3.13",
      updateAvailable: true,
      upgradePlan: {
        displayCommand: "npx ctx7@latest <command>",
        canRun: false,
        needsExplicitVersion: true,
      },
    });

    await maybeShowUpgradeNotice({
      actionName: "library",
      argv: ["node", "ctx7", "library", "react"],
      isInteractive: true,
    });

    expect(plainLogOutput().some((line) => line.includes("Use npx ctx7@latest <command>"))).toBe(
      true
    );
    expect(plainLogOutput().some((line) => line.includes("ctx7 upgrade"))).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(markUpdateNotificationShown).toHaveBeenCalledWith("0.3.13");
  });

  test("skips notice for upgrade command", async () => {
    await maybeShowUpgradeNotice({
      actionName: "upgrade",
      argv: ["node", "ctx7", "upgrade"],
      isInteractive: true,
    });

    expect(checkForUpdates).not.toHaveBeenCalled();
  });
});
