import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { experimentalToolsFromChoice, type ExperimentalTool } from "./tool-names.js";

/**
 * The stdio server's experimental tools choice, kept on disk between processes. An MCP client
 * starts a new stdio process for each session, so the in-memory cache of `fetchExperimentalTools`
 * never helps it (CTX7-3942).
 *
 * The file name is a salted hash of the API URL and the credential, so one credential cannot read
 * the entry of another and the token is never stored. The directory is 0700 and the files 0600,
 * and an entry that does not meet those rules is ignored. This is only a cache: every file system
 * problem means a normal lookup through the API.
 */
export const EXPERIMENTAL_TOOLS_DISK_TTL_MS = 5 * 60_000;

const FORMAT_VERSION = 1;
const MAX_ENTRY_BYTES = 16 * 1024;
/** A slow or hung file system (a network home directory) must not delay the server's start. */
const FILE_SYSTEM_BUDGET_MS = 250;
const GROUP_OR_OTHER_BITS = 0o077;

export interface StoredExperimentalTools {
  tools: ExperimentalTool[];
  expiresAt: number;
}

function cacheDirectory(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const root = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".cache");
  return join(root, "context7", "mcp-experimental-tools");
}

function entryPath(apiKey: string): string {
  const name = createHash("sha256")
    .update(`context7-mcp-experimental-tools\0${FORMAT_VERSION}\0`)
    .update(`${CONTEXT7_API_BASE_URL}\0${apiKey}`)
    .digest("hex");
  return join(cacheDirectory(), `${name}.json`);
}

/** Owned by this user and closed to everyone else. Windows reports neither, so it only has the type check. */
function isPrivate(stats: { uid: number; mode: number }): boolean {
  if (process.platform === "win32") return true;
  return stats.uid === process.getuid?.() && (stats.mode & GROUP_OR_OTHER_BITS) === 0;
}

async function withinBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), FILE_SYSTEM_BUDGET_MS);
    timer.unref?.();
  });
  try {
    return await Promise.race([work.catch(() => fallback), expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function readEntry(apiKey: string): Promise<StoredExperimentalTools | undefined> {
  const file = await open(entryPath(apiKey), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = await file.stat();
    if (!stats.isFile() || !isPrivate(stats) || stats.size > MAX_ENTRY_BYTES) return undefined;
    const entry = JSON.parse(await file.readFile("utf8")) as {
      version?: unknown;
      storedAt?: unknown;
      tools?: unknown;
    };
    if (entry.version !== FORMAT_VERSION || typeof entry.storedAt !== "number") return undefined;
    if (!Array.isArray(entry.tools)) return undefined;
    const now = Date.now();
    const expiresAt = entry.storedAt + EXPERIMENTAL_TOOLS_DISK_TTL_MS;
    // A time in the future is a changed clock: it must not keep the entry alive.
    if (entry.storedAt > now || expiresAt <= now) return undefined;
    return { tools: experimentalToolsFromChoice({ tools: entry.tools }), expiresAt };
  } finally {
    await file.close();
  }
}

async function writeEntry(apiKey: string, tools: readonly ExperimentalTool[]): Promise<void> {
  const directory = cacheDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || !isPrivate(stats)) return;

  const target = entryPath(apiKey);
  // Parallel processes each write their own file; the rename makes the last one win whole.
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({ version: FORMAT_VERSION, storedAt: Date.now(), tools })
      );
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** The credential's unexpired choice, or undefined. Never throws. */
export async function readStoredExperimentalTools(
  apiKey: string
): Promise<StoredExperimentalTools | undefined> {
  try {
    return await withinBudget(readEntry(apiKey), undefined);
  } catch {
    return undefined;
  }
}

/** Keeps the credential's choice when the disk allows it. Never throws. */
export async function storeExperimentalTools(
  apiKey: string,
  tools: readonly ExperimentalTool[]
): Promise<void> {
  try {
    await withinBudget(writeEntry(apiKey, tools), undefined);
  } catch {
    // A read-only or full disk only costs the next process a lookup.
  }
}
