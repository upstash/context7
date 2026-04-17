import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import {
  checkForUpdates,
  compareVersions,
  detectInstallMethod,
  getUpgradePlan,
  markUpdateNotificationShown,
  shouldShowUpdateNotification,
  shouldSkipUpdateNotifier,
} from "../utils/update-check.js";

let tempDir: string;
let stateFile: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `ctx7-update-${Date.now()}`);
  stateFile = join(tempDir, "cli-state.json");
  await mkdir(tempDir, { recursive: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch not mocked");
    })
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.doUnmock("os");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("compareVersions", () => {
  test("orders semantic versions correctly", () => {
    expect(compareVersions("0.3.14", "0.3.13")).toBeGreaterThan(0);
    expect(compareVersions("0.3.13", "0.3.13")).toBe(0);
    expect(compareVersions("0.3.13", "0.3.14")).toBeLessThan(0);
  });
});

describe("detectInstallMethod", () => {
  test("detects npx and pnpm dlx", () => {
    expect(
      detectInstallMethod({
        npm_execpath: "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
        npm_command: "exec",
      })
    ).toBe("npx");

    expect(
      detectInstallMethod({
        npm_execpath: "/Users/test/Library/pnpm/pnpm.cjs",
        npm_command: "dlx",
      })
    ).toBe("pnpm-dlx");
  });

  test("detects npm, pnpm, bun, and bunx style shells", () => {
    expect(
      detectInstallMethod({
        npm_execpath: "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
        npm_command: "install",
      })
    ).toBe("npm-global");

    expect(
      detectInstallMethod({
        npm_execpath: "/Users/test/Library/pnpm/pnpm.cjs",
        npm_command: "add",
      })
    ).toBe("pnpm-global");

    expect(
      detectInstallMethod({
        npm_execpath: "/Users/test/.bun/bin/bun",
        npm_command: "add",
      })
    ).toBe("bun-global");

    expect(
      detectInstallMethod({
        npm_execpath: "/Users/test/.bun/bin/bun",
        npm_command: "x",
      })
    ).toBe("bunx");
  });

  test("falls back to npm-global for npm user agents", () => {
    expect(detectInstallMethod({ npm_config_user_agent: "npm/10.0.0 node/v22.0.0" })).toBe(
      "npm-global"
    );
  });
});

describe("getUpgradePlan", () => {
  test("returns explicit runner commands for ephemeral installs", () => {
    expect(getUpgradePlan("npx").displayCommand).toBe("npx ctx7@latest <command>");
    expect(getUpgradePlan("pnpm-dlx").displayCommand).toBe("pnpm dlx ctx7@latest <command>");
  });

  test("does not auto-run upgrade plans for unknown installs", () => {
    expect(getUpgradePlan("unknown").canRun).toBe(false);
  });
});

describe("checkForUpdates", () => {
  test("fetches and caches the latest version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "9.9.9" }),
      })
    );

    const info = await checkForUpdates({
      force: true,
      stateFile,
      now: 123456,
    });

    expect(info?.latestVersion).toBe("9.9.9");
    expect(info?.updateAvailable).toBe(true);
  });

  test("uses cached latest version when the cache is fresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "9.9.9" }),
      })
    );

    await checkForUpdates({ force: true, stateFile, now: 1000 });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const info = await checkForUpdates({
      stateFile,
      now: 2000,
      cacheTtlMs: 10_000,
    });

    expect(info?.latestVersion).toBe("9.9.9");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("default cli-state persistence", () => {
  test("writes updater state under ~/.context7/cli-state.json when using the default path", async () => {
    const fakeHome = join(tempDir, "fake-home");
    await mkdir(fakeHome, { recursive: true });

    vi.resetModules();
    vi.doMock("os", async () => {
      const actual = await vi.importActual<typeof import("os")>("os");
      return { ...actual, homedir: () => fakeHome };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: "9.9.9" }),
      })
    );

    const updateCheck = await import("../utils/update-check.js");

    await updateCheck.checkForUpdates({ force: true, now: 1000 });
    await updateCheck.markUpdateNotificationShown("9.9.9", { now: 2000 });

    const persisted = JSON.parse(
      await readFile(join(fakeHome, ".context7", "cli-state.json"), "utf-8")
    ) as {
      latestVersion?: string;
      lastCheckedAt?: number;
      notifiedVersion?: string;
      lastNotifiedAt?: number;
    };

    expect(persisted).toEqual({
      latestVersion: "9.9.9",
      lastCheckedAt: 1000,
      notifiedVersion: "9.9.9",
      lastNotifiedAt: 2000,
    });
  });
});

describe("update notifications", () => {
  test("respects notification cooldown per latest version", async () => {
    const info = {
      currentVersion: "0.3.13",
      latestVersion: "9.9.9",
      updateAvailable: true,
      installMethod: "npm-global" as const,
      upgradePlan: getUpgradePlan("npm-global"),
    };

    expect(await shouldShowUpdateNotification(info, { stateFile, now: 1000 })).toBe(true);

    await markUpdateNotificationShown("9.9.9", { stateFile, now: 1000 });

    expect(await shouldShowUpdateNotification(info, { stateFile, now: 2000 })).toBe(false);
    expect(
      await shouldShowUpdateNotification(info, { stateFile, now: 1000 + 25 * 60 * 60 * 1000 })
    ).toBe(true);
  });

  test("skips notifier for json and version argv", () => {
    expect(shouldSkipUpdateNotifier(["node", "ctx7", "library", "react", "--json"])).toBe(true);
    expect(shouldSkipUpdateNotifier(["node", "ctx7", "--version"])).toBe(true);
    expect(shouldSkipUpdateNotifier(["node", "ctx7", "skills", "list"])).toBe(false);
  });
});
