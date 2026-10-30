import { execFile, execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { detectLicense, type LicenseInfo } from "./safety.js";

const execFileAsync = promisify(execFile);

/** Library IDs that come from documentation websites have no Git repo behind them. */
const NON_REPO_ORGS = new Set(["websites", "llmstxt"]);

/** A default-branch checkout is refreshed after this long. Tags never change. */
const HEAD_TTL_MS = 24 * 60 * 60 * 1000;

const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const LS_REMOTE_TIMEOUT_MS = 60 * 1000;

export class CodeSearchError extends Error {}

/** True when a `git` binary is on PATH. */
export function isGitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export interface CodeSearchConfig {
  /** Directory that holds checkouts and indexes. */
  cacheDir: string;
  /** Base URL that `<org>/<repo>` is appended to. */
  gitBaseUrl: string;
  /** Least recently used checkouts are deleted above this size. 0 means no limit. */
  maxCacheBytes?: number;
  /** A tool call waits this long for a clone, then asks the agent to retry. */
  cloneWaitMs?: number;
}

const DEFAULT_CACHE_MB = 5 * 1024;
const DEFAULT_CLONE_WAIT_SECONDS = 45;

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : fallback;
}

export function codeSearchConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CodeSearchConfig {
  const xdgCache = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return {
    cacheDir: env.CONTEXT7_CODE_CACHE_DIR || path.join(xdgCache, "context7", "code"),
    gitBaseUrl: (env.CONTEXT7_CODE_GIT_BASE || "https://github.com").replace(/\/+$/, ""),
    maxCacheBytes: numberFromEnv(env.CONTEXT7_CODE_CACHE_MAX_MB, DEFAULT_CACHE_MB) * 1024 * 1024,
    cloneWaitMs: numberFromEnv(env.CONTEXT7_CODE_WAIT_SECONDS, DEFAULT_CLONE_WAIT_SECONDS) * 1000,
  };
}

export interface LibraryRef {
  org: string;
  repo: string;
  /** Version from the library ID suffix (`/org/repo/v1.2.3`), if any. */
  version?: string;
}

/** Parses `/org/repo` or `/org/repo/version`. */
export function parseLibraryId(libraryId: string): LibraryRef {
  const parts = libraryId
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part)) {
    throw new CodeSearchError(
      `Invalid library ID '${libraryId}'. Use the format '/org/project' or '/org/project/version'.`
    );
  }
  const [org, repo, version] = parts;
  const safeName = /^[A-Za-z0-9_.-]+$/;
  if (!safeName.test(org) || !safeName.test(repo) || org.startsWith(".") || repo.startsWith(".")) {
    throw new CodeSearchError(`Invalid library ID '${libraryId}'.`);
  }
  if (NON_REPO_ORGS.has(org.toLowerCase())) {
    throw new CodeSearchError(
      `Source search is not available for '${libraryId}': this library comes from a documentation website, not a Git repository. Use 'query-docs' instead.`
    );
  }
  return { org, repo, version };
}

interface ParsedVersion {
  parts: number[];
  prerelease: boolean;
}

/** Reads the trailing version of a tag, e.g. `pyiceberg-0.11.1` or `@scope/pkg@2.3.0-rc.1`. */
export function parseTagVersion(tag: string): ParsedVersion | undefined {
  const match = tag.match(/(\d+(?:\.\d+)*)((?:[-.+]?[A-Za-z][\w.-]*)?)$/);
  if (!match) return undefined;
  const parts = match[1].split(".").map(Number);
  const suffix = match[2] ?? "";
  return {
    parts,
    prerelease: /(alpha|beta|rc|pre|dev|canary|next|nightly|snapshot)/i.test(suffix),
  };
}

function compareParts(left: number[], right: number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The part of a tag before its version, e.g. `@tanstack/query-core@` or `v`. */
function tagPrefix(tag: string): string {
  const match = tag.match(/^(.*?)\d+(?:\.\d+)*(?:[-.+]?[A-Za-z][\w.-]*)?$/);
  return (match?.[1] ?? tag).toLowerCase();
}

/**
 * Picks the tag for a requested version. `2.19` matches the highest stable `2.19.x` tag.
 * An exact tag name always wins. Pre-releases match only when the request names one.
 * In a monorepo with per-package tags, plain tags (`v1.2.3`) win, then tags that
 * contain the repository name.
 */
export function resolveVersionTag(
  version: string,
  tags: string[],
  repo?: string
): string | undefined {
  const wanted = version.trim();
  const bare = wanted.replace(/^v/i, "");
  for (const candidate of [wanted, `v${bare}`, bare]) {
    if (tags.includes(candidate)) return candidate;
  }

  const requested = parseTagVersion(bare);
  if (!requested) return undefined;
  // A pre-release request must match that exact pre-release, e.g. `pkg@2.0.0-rc.1`.
  if (requested.prerelease) return tags.find((tag) => tag.endsWith(bare));

  const bestByPrefix = new Map<string, { tag: string; parsed: ParsedVersion }>();
  for (const tag of tags) {
    const parsed = parseTagVersion(tag);
    if (!parsed || parsed.prerelease) continue;
    const prefix = parsed.parts.slice(0, requested.parts.length);
    if (compareParts(prefix, requested.parts) !== 0) continue;
    const key = tagPrefix(tag);
    const best = bestByPrefix.get(key);
    if (!best || compareParts(parsed.parts, best.parsed.parts) > 0) {
      bestByPrefix.set(key, { tag, parsed });
    }
  }
  if (bestByPrefix.size === 0) return undefined;

  const repoName = repo?.toLowerCase().replace(/\.js$/, "");
  const preferred =
    bestByPrefix.get("v") ??
    bestByPrefix.get("") ??
    [...bestByPrefix.entries()].find(
      ([prefix]) => repoName && prefix.replace(/[@/_-]+$/, "").endsWith(repoName)
    )?.[1];
  if (preferred) return preferred.tag;
  return [...bestByPrefix.values()].sort((a, b) => compareParts(b.parsed.parts, a.parsed.parts))[0]
    .tag;
}

/** True when a tag names the requested version itself, not only a version prefix of it. */
function isExactVersionTag(version: string, tag: string): boolean {
  const bare = version.trim().replace(/^v/i, "").toLowerCase();
  return tag.toLowerCase().slice(tagPrefix(tag).length) === bare;
}

/**
 * Settings for every clone. A clone must never run repository code: no hooks, no
 * submodules, no fsmonitor, and symlinks become plain files (CVE-2024-32002,
 * CVE-2025-48384).
 */
const SAFE_GIT_CONFIG = [
  "core.hooksPath=/dev/null",
  "core.symlinks=false",
  "core.fsmonitor=false",
  "submodule.recurse=false",
  "protocol.ext.allow=never",
  "advice.detachedHead=false",
].flatMap((setting) => ["-c", setting]);

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

async function listRemoteTags(url: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "--tags", "--refs", url], {
      env: gitEnv(),
      timeout: LS_REMOTE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => line.split("refs/tags/")[1])
      .filter((tag): tag is string => Boolean(tag));
  } catch {
    throw new CodeSearchError(`Could not reach the source repository ${url}.`);
  }
}

export interface Checkout {
  org: string;
  repo: string;
  /** Tag name, or `HEAD` for the default branch. */
  ref: string;
  commit: string;
  /** Repository URL the checkout came from. */
  url: string;
  /** The requested version, when the tag was picked by a version prefix match. */
  approximateVersion?: string;
  license?: LicenseInfo;
  /** Absolute path of the working tree. */
  root: string;
  /** Directory that holds the working tree and its index. */
  dir: string;
}

interface CheckoutMeta {
  ref: string;
  commit: string;
  fetchedAt: number;
  /** Last time a tool call used this checkout. Eviction removes the oldest first. */
  usedAt?: number;
  /** Disk size of the checkout directory. */
  bytes?: number;
  license?: LicenseInfo;
}

const inFlight = new Map<string, Promise<Checkout>>();
/** Checkout directories that a running clone writes to. Eviction skips them. */
const activeDirs = new Set<string>();

/** Tag lists are reused for an hour so repeated calls skip `git ls-remote`. */
const TAGS_TTL_MS = 60 * 60 * 1000;
const tagCache = new Map<string, { tags: string[]; at: number }>();

async function cachedTags(url: string): Promise<string[]> {
  const hit = tagCache.get(url);
  if (hit && Date.now() - hit.at < TAGS_TTL_MS) return hit.tags;
  const tags = await listRemoteTags(url);
  tagCache.set(url, { tags, at: Date.now() });
  return tags;
}

/** Clones the library at the resolved version once, then reuses the cached checkout. */
export async function ensureCheckout(
  config: CodeSearchConfig,
  libraryId: string,
  versionOverride?: string
): Promise<Checkout> {
  const lib = parseLibraryId(libraryId);
  const version = versionOverride?.trim() || lib.version;
  const url = `${config.gitBaseUrl}/${lib.org}/${lib.repo}`;

  let ref = "HEAD";
  let approximateVersion: string | undefined;
  if (version && version.toLowerCase() !== "latest") {
    const tags = await cachedTags(url);
    const tag = resolveVersionTag(version, tags, lib.repo);
    if (!tag) {
      const recent = tags
        .filter((t) => parseTagVersion(t) && !parseTagVersion(t)!.prerelease)
        .sort((a, b) => compareParts(parseTagVersion(b)!.parts, parseTagVersion(a)!.parts))
        .slice(0, 8);
      throw new CodeSearchError(
        `No tag matches version '${version}' in ${lib.org}/${lib.repo}.` +
          (recent.length
            ? ` Recent tags: ${recent.join(", ")}.`
            : " The repository has no version tags.")
      );
    }
    ref = tag;
    if (!isExactVersionTag(version, tag)) approximateVersion = version;
  }

  const key = `${lib.org}/${lib.repo}@${ref}`.toLowerCase();
  let pending = inFlight.get(key);
  if (!pending) {
    pending = cloneOrReuse(config, lib, url, ref).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const checkout = await pending;
  return approximateVersion ? { ...checkout, approximateVersion } : checkout;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.@-]/g, "_");
}

async function cloneOrReuse(
  config: CodeSearchConfig,
  lib: LibraryRef,
  url: string,
  ref: string
): Promise<Checkout> {
  const dir = path.join(
    config.cacheDir,
    `${safeSegment(lib.org)}__${safeSegment(lib.repo)}`.toLowerCase(),
    safeSegment(ref)
  );
  const root = path.join(dir, "src");
  const metaPath = path.join(dir, "meta.json");

  const existing = await readMeta(metaPath);
  const fresh = existing && (ref !== "HEAD" || Date.now() - existing.fetchedAt < HEAD_TTL_MS);
  if (existing && fresh && (await isDirectory(root))) {
    const meta = { ...existing };
    if (!meta.license) meta.license = await detectLicense(root);
    // Write the use time at most once a minute, to keep repeated calls cheap.
    if (!existing.license || Date.now() - (existing.usedAt ?? 0) > 60_000) {
      meta.usedAt = Date.now();
      await writeFile(metaPath, JSON.stringify(meta)).catch(() => {});
    }
    return {
      org: lib.org,
      repo: lib.repo,
      ref,
      commit: meta.commit,
      url,
      root,
      dir,
      license: meta.license,
    };
  }

  await mkdir(dir, { recursive: true });
  activeDirs.add(dir);
  const tmp = path.join(dir, `src.tmp-${process.pid}-${Date.now()}`);
  const args = [
    ...SAFE_GIT_CONFIG,
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--single-branch",
    "--no-tags",
    "--no-recurse-submodules",
  ];
  if (ref !== "HEAD") args.push("--branch", ref);
  args.push("--", url, tmp);

  try {
    await execFileAsync("git", args, { env: gitEnv(), timeout: CLONE_TIMEOUT_MS });
    const { stdout } = await execFileAsync("git", ["-C", tmp, "rev-parse", "HEAD"], {
      env: gitEnv(),
    });
    await rm(root, { recursive: true, force: true });
    await rm(path.join(dir, "index.json"), { force: true });
    await rename(tmp, root);
    const now = Date.now();
    const meta: CheckoutMeta = {
      ref,
      commit: stdout.trim(),
      fetchedAt: now,
      usedAt: now,
      bytes: await directorySize(root),
      license: await detectLicense(root),
    };
    await writeFile(metaPath, JSON.stringify(meta));
    await enforceCacheLimit(config, dir);
    return {
      org: lib.org,
      repo: lib.repo,
      ref,
      commit: meta.commit,
      url,
      root,
      dir,
      license: meta.license,
    };
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    if (error instanceof CodeSearchError) throw error;
    throw new CodeSearchError(`Could not clone ${lib.org}/${lib.repo} at ${ref}.`);
  } finally {
    activeDirs.delete(dir);
  }
}

async function directorySize(target: string): Promise<number> {
  let total = 0;
  const pending = [target];
  while (pending.length) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else
        total += await lstat(full).then(
          (info) => info.size,
          () => 0
        );
    }
  }
  return total;
}

/**
 * Deletes the least recently used checkouts until the cache fits its limit.
 * The checkout in `keepDir` and any checkout a clone is writing stay.
 */
export async function enforceCacheLimit(config: CodeSearchConfig, keepDir: string): Promise<void> {
  const limit = config.maxCacheBytes ?? 0;
  if (limit <= 0) return;

  const entries: { dir: string; bytes: number; usedAt: number }[] = [];
  for (const repoDir of await readdir(config.cacheDir).catch(() => [] as string[])) {
    const repoPath = path.join(config.cacheDir, repoDir);
    for (const refDir of await readdir(repoPath).catch(() => [] as string[])) {
      const dir = path.join(repoPath, refDir);
      const meta = await readMeta(path.join(dir, "meta.json"));
      if (!meta) continue;
      entries.push({ dir, bytes: meta.bytes ?? 0, usedAt: meta.usedAt ?? meta.fetchedAt });
    }
  }

  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of entries.sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= limit) break;
    if (entry.dir === keepDir || activeDirs.has(entry.dir)) continue;
    await rm(entry.dir, { recursive: true, force: true });
    total -= entry.bytes;
  }
}

async function readMeta(metaPath: string): Promise<CheckoutMeta | undefined> {
  try {
    return JSON.parse(await readFile(metaPath, "utf8")) as CheckoutMeta;
  } catch {
    return undefined;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
