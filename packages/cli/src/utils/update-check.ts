import { homedir } from "os";
import { dirname, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { NAME, VERSION } from "../constants.js";

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_STATE_FILE = join(homedir(), ".context7", "cli-state.json");

export type InstallMethod =
  | "npm-global"
  | "pnpm-global"
  | "bun-global"
  | "npx"
  | "pnpm-dlx"
  | "bunx"
  | "unknown";

interface UpdateState {
  latestVersion?: string;
  lastCheckedAt?: number;
  notifiedVersion?: string;
  lastNotifiedAt?: number;
}

export interface UpgradePlan {
  installMethod: InstallMethod;
  command: string;
  args: string[];
  displayCommand: string;
  canRun: boolean;
  needsExplicitVersion: boolean;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  installMethod: InstallMethod;
  upgradePlan: UpgradePlan;
}

interface CheckForUpdatesOptions {
  force?: boolean;
  now?: number;
  cacheTtlMs?: number;
  stateFile?: string;
}

function getStateFilePath(stateFile?: string): string {
  return stateFile ?? UPDATE_STATE_FILE;
}

async function readUpdateState(stateFile?: string): Promise<UpdateState> {
  try {
    const raw = await readFile(getStateFilePath(stateFile), "utf-8");
    return JSON.parse(raw) as UpdateState;
  } catch {
    return {};
  }
}

async function writeUpdateState(state: UpdateState, stateFile?: string): Promise<void> {
  const path = getStateFilePath(stateFile);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function compareVersions(a: string, b: string): number {
  const normalize = (version: string): number[] =>
    version
      .split("-", 1)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = normalize(a);
  const right = normalize(b);
  const max = Math.max(left.length, right.length);

  for (let i = 0; i < max; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function detectInstallMethod(env: NodeJS.ProcessEnv = process.env): InstallMethod {
  const execPath = env.npm_execpath?.toLowerCase() ?? "";
  const npmCommand = env.npm_command?.toLowerCase() ?? "";
  const userAgent = env.npm_config_user_agent?.toLowerCase() ?? "";

  if (execPath.includes("pnpm") && npmCommand === "dlx") return "pnpm-dlx";
  if (execPath.includes("pnpm")) return "pnpm-global";
  if (execPath.includes("bun") && npmCommand === "x") return "bunx";
  if (execPath.includes("bun")) return "bun-global";
  if (execPath.includes("npm") && npmCommand === "exec") return "npx";
  if (execPath.includes("npm")) return "npm-global";

  if (userAgent.startsWith("pnpm/")) return "pnpm-global";
  if (userAgent.startsWith("bun/")) return "bun-global";
  if (userAgent.startsWith("npm/")) return "npm-global";

  return "unknown";
}

export function getUpgradePlan(
  installMethod = detectInstallMethod(),
  packageName = NAME
): UpgradePlan {
  switch (installMethod) {
    case "pnpm-global":
      return {
        installMethod,
        command: "pnpm",
        args: ["add", "-g", `${packageName}@latest`],
        displayCommand: `pnpm add -g ${packageName}@latest`,
        canRun: true,
        needsExplicitVersion: false,
      };
    case "bun-global":
      return {
        installMethod,
        command: "bun",
        args: ["add", "-g", `${packageName}@latest`],
        displayCommand: `bun add -g ${packageName}@latest`,
        canRun: true,
        needsExplicitVersion: false,
      };
    case "npx":
      return {
        installMethod,
        command: "npx",
        args: [`${packageName}@latest`],
        displayCommand: `npx ${packageName}@latest <command>`,
        canRun: false,
        needsExplicitVersion: true,
      };
    case "pnpm-dlx":
      return {
        installMethod,
        command: "pnpm",
        args: ["dlx", `${packageName}@latest`],
        displayCommand: `pnpm dlx ${packageName}@latest <command>`,
        canRun: false,
        needsExplicitVersion: true,
      };
    case "bunx":
      return {
        installMethod,
        command: "bunx",
        args: [`${packageName}@latest`],
        displayCommand: `bunx ${packageName}@latest <command>`,
        canRun: false,
        needsExplicitVersion: true,
      };
    case "unknown":
      return {
        installMethod,
        command: "npm",
        args: ["install", "-g", `${packageName}@latest`],
        displayCommand: `npm install -g ${packageName}@latest`,
        canRun: false,
        needsExplicitVersion: false,
      };
    case "npm-global":
    default:
      return {
        installMethod: "npm-global",
        command: "npm",
        args: ["install", "-g", `${packageName}@latest`],
        displayCommand: `npm install -g ${packageName}@latest`,
        canRun: true,
        needsExplicitVersion: false,
      };
  }
}

async function fetchLatestVersion(packageName = NAME): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(
  options: CheckForUpdatesOptions = {}
): Promise<UpdateInfo | null> {
  const now = options.now ?? Date.now();
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const stateFile = options.stateFile;
  const state = await readUpdateState(stateFile);
  const isStale =
    options.force ||
    !state.lastCheckedAt ||
    now - state.lastCheckedAt >= cacheTtlMs ||
    !state.latestVersion;

  let latestVersion = state.latestVersion ?? null;

  if (isStale) {
    const fetchedVersion = await fetchLatestVersion();
    if (fetchedVersion) {
      latestVersion = fetchedVersion;
      await writeUpdateState(
        {
          ...state,
          latestVersion: fetchedVersion,
          lastCheckedAt: now,
        },
        stateFile
      );
    }
  }

  if (!latestVersion) return null;

  const installMethod = detectInstallMethod();

  return {
    currentVersion: VERSION,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, VERSION) > 0,
    installMethod,
    upgradePlan: getUpgradePlan(installMethod),
  };
}

export async function shouldShowUpdateNotification(
  info: UpdateInfo,
  options: { now?: number; stateFile?: string; cooldownMs?: number } = {}
): Promise<boolean> {
  if (!info.updateAvailable) return false;

  const now = options.now ?? Date.now();
  const cooldownMs = options.cooldownMs ?? DEFAULT_CACHE_TTL_MS;
  const state = await readUpdateState(options.stateFile);

  if (
    state.notifiedVersion === info.latestVersion &&
    state.lastNotifiedAt &&
    now - state.lastNotifiedAt < cooldownMs
  ) {
    return false;
  }

  return true;
}

export async function markUpdateNotificationShown(
  latestVersion: string,
  options: { now?: number; stateFile?: string } = {}
): Promise<void> {
  const now = options.now ?? Date.now();
  const state = await readUpdateState(options.stateFile);
  await writeUpdateState(
    {
      ...state,
      notifiedVersion: latestVersion,
      lastNotifiedAt: now,
    },
    options.stateFile
  );
}

export function shouldSkipUpdateNotifier(argv = process.argv): boolean {
  return argv.includes("--json") || argv.includes("-v") || argv.includes("--version");
}
