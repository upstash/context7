import { createHash } from "crypto";

import { VERSION } from "../constants.js";
import type { SkillFile } from "../types.js";
import { readCliState, updateCliState } from "./cli-state.js";
import { compareVersions } from "./update-check.js";

const RAW_BASES = [
  "https://raw.githubusercontent.com/upstash/context7/master",
  "https://raw.githubusercontent.com/upstash/context7/main",
];
const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface ManifestFile {
  path: string;
  hash: string;
}

export interface SkillEntry {
  revision: number;
  minCliVersion: string;
  files: ManifestFile[];
}

export interface RuleEntry {
  revision: number;
  minCliVersion: string;
  hash: string;
}

export interface ContentManifest {
  schema: number;
  skills: Record<string, SkillEntry>;
  rules: Record<string, RuleEntry>;
}

export interface ResolvedSkill {
  revision: number;
  files: SkillFile[];
}

export interface ResolvedRule {
  revision: number;
  content: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
}

export function hashFiles(files: SkillFile[]): string {
  const payload = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((file) => `${file.path}\n${file.content.replace(/\r\n/g, "\n")}`)
    .join("\0");
  return hashContent(payload);
}

async function fetchRaw(path: string): Promise<string | null> {
  for (const base of RAW_BASES) {
    try {
      const response = await fetch(`${base}/${path}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) return await response.text();
    } catch {
      continue;
    }
  }
  return null;
}

let inFlight: Promise<ContentManifest | null> | null = null;

export async function getManifest(
  options: { force?: boolean; now?: number } = {}
): Promise<ContentManifest | null> {
  if (!options.force && inFlight) return inFlight;

  const load = async (): Promise<ContentManifest | null> => {
    const now = options.now ?? Date.now();
    const cached = (await readCliState()).contentManifest;

    if (!options.force && cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
      return cached.manifest;
    }

    const raw = await fetchRaw("skills/manifest.json");
    if (raw === null) return cached?.manifest ?? null;

    try {
      const manifest = JSON.parse(raw) as ContentManifest;
      if (!manifest.skills || !manifest.rules) return cached?.manifest ?? null;
      await updateCliState({ contentManifest: { fetchedAt: now, manifest } });
      return manifest;
    } catch {
      return cached?.manifest ?? null;
    }
  };

  inFlight = load();
  return inFlight;
}

export function supportsEntry(entry: { minCliVersion?: string }): boolean {
  return compareVersions(VERSION, entry.minCliVersion ?? "0.0.0") >= 0;
}

export async function resolveSkill(name: string): Promise<ResolvedSkill | null> {
  const entry = (await getManifest())?.skills?.[name];
  if (!entry) return null;

  const files: SkillFile[] = [];
  for (const file of entry.files) {
    if (file.path.includes("..")) return null;
    const content = await fetchRaw(`skills/${name}/${file.path}`);
    if (content === null || hashContent(content) !== file.hash) return null;
    files.push({ path: file.path, content });
  }

  return { revision: entry.revision, files };
}

export async function resolveRule(filename: string): Promise<ResolvedRule | null> {
  const entry = (await getManifest())?.rules?.[filename];
  if (!entry) return null;

  const content = await fetchRaw(`rules/${filename}`);
  if (content === null || hashContent(content) !== entry.hash) return null;

  return { revision: entry.revision, content };
}

export function resetManifestCache(): void {
  inFlight = null;
}
