import { dirname } from "path";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";

import type { ContentManifest } from "./content.js";
import {
  UPDATE_STATE_FILE_NAME,
  getUpdateStateFilePath,
  migrateLegacyFile,
  resolveReadPath,
} from "./storage-paths.js";

export interface SkillInstall {
  kind: "skill";
  name: string;
  agent: string;
  scope: "global" | "project";
  revision: number;
  hash: string;
  files: string[];
}

export interface RuleInstall {
  kind: "rule";
  name: string;
  agent: string;
  scope: "global" | "project";
  mode: "mcp" | "cli";
  revision: number;
  hash: string;
}

export type Install = SkillInstall | RuleInstall;

export interface CliState {
  latestVersion?: string;
  lastCheckedAt?: number;
  notifiedVersion?: string;
  lastNotifiedAt?: number;
  contentManifest?: { fetchedAt: number; manifest: ContentManifest };
  contentNotifiedAt?: number;
  contentRetryAfter?: number;
  installs?: Record<string, Install>;
}

function statePath(stateFile?: string): string {
  return stateFile ?? process.env.CTX7_STATE_FILE ?? getUpdateStateFilePath();
}

export function getStatePath(): string {
  return statePath();
}

const LOCK_STALE_MS = 60_000;
let lockDepth = 0;

/**
 * Re-entrant within a process, stale-tolerant across processes. The default wait
 * is deliberately short: this sits on the hot path of every command, so bounded
 * last-writer-wins beats stalling a docs query behind another process.
 */
export async function acquireStateLock(target: string, timeoutMs = 250): Promise<boolean> {
  if (lockDepth > 0) {
    lockDepth++;
    return true;
  }

  const lockFile = `${target}.lock`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: "wx" });
      lockDepth = 1;
      return true;
    } catch {
      // Held elsewhere.
    }

    const info = await stat(lockFile).catch(() => null);
    const stale = info !== null && Date.now() - info.mtimeMs > LOCK_STALE_MS;
    if (stale) {
      await rm(lockFile, { force: true }).catch(() => {});
    }

    if (Date.now() >= deadline) return false;
    if (!stale) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function releaseStateLock(target: string): Promise<void> {
  if (lockDepth === 0) return;
  lockDepth--;
  if (lockDepth === 0) {
    await rm(`${target}.lock`, { force: true }).catch(() => {});
  }
}

export async function readCliState(stateFile?: string): Promise<CliState> {
  const target = statePath(stateFile);
  const path =
    target === getUpdateStateFilePath()
      ? await resolveReadPath(UPDATE_STATE_FILE_NAME, target)
      : target;

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return {};
  }

  try {
    return JSON.parse(raw) as CliState;
  } catch {
    // Quarantine rather than read {} forever: an unparseable file would otherwise
    // silently disable install tracking on every future run.
    await rename(path, `${path}.corrupt`).catch(() => {});
    return {};
  }
}

/**
 * Written via a temp file and rename so a crash mid-write cannot leave truncated
 * JSON behind, and under the shared lock so a concurrent writer holding an older
 * copy in memory cannot clobber records it never read.
 */
export async function writeCliState(state: CliState, stateFile?: string): Promise<void> {
  const path = statePath(stateFile);
  if (path === getUpdateStateFilePath()) {
    await migrateLegacyFile(UPDATE_STATE_FILE_NAME, path);
  }
  await mkdir(dirname(path), { recursive: true });

  const held = await acquireStateLock(path);
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n", "utf-8");
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
    if (held) await releaseStateLock(path);
  }
}

export async function updateCliState(
  patch: Partial<CliState>,
  stateFile?: string
): Promise<CliState> {
  const next = { ...(await readCliState(stateFile)), ...patch };
  await writeCliState(next, stateFile);
  return next;
}

export async function recordInstall(path: string, install: Install): Promise<void> {
  const state = await readCliState();
  await writeCliState({ ...state, installs: { ...state.installs, [path]: install } });
}

export async function forgetInstall(path: string): Promise<void> {
  const state = await readCliState();
  if (!state.installs?.[path]) return;
  const installs = { ...state.installs };
  delete installs[path];
  await writeCliState({ ...state, installs });
}
