import { dirname } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

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
  installs?: Record<string, Install>;
}

function statePath(stateFile?: string): string {
  return stateFile ?? process.env.CTX7_STATE_FILE ?? getUpdateStateFilePath();
}

export async function readCliState(stateFile?: string): Promise<CliState> {
  const target = statePath(stateFile);
  const path =
    target === getUpdateStateFilePath()
      ? await resolveReadPath(UPDATE_STATE_FILE_NAME, target)
      : target;

  try {
    return JSON.parse(await readFile(path, "utf-8")) as CliState;
  } catch {
    return {};
  }
}

export async function writeCliState(state: CliState, stateFile?: string): Promise<void> {
  const path = statePath(stateFile);
  if (path === getUpdateStateFilePath()) {
    await migrateLegacyFile(UPDATE_STATE_FILE_NAME, path);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
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
