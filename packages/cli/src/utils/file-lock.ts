import * as fs from "fs";

/** Releases the lock. Safe to call if the lock file is already gone. */
export type ReleaseLock = () => void;

export interface FileLockOptions {
  /**
   * A lock file older than this is treated as left behind by a process that
   * died without releasing it, and is removed so no command hangs on it.
   */
  staleMs?: number;
  /** Delay between attempts while another process holds the lock. */
  pollMs?: number;
}

export const DEFAULT_LOCK_STALE_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 50;

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-process mutex backed by a lock file created with `O_EXCL`, which is
 * atomic on every filesystem Node supports. The file's existence is the lock;
 * the descriptor is closed right away so the holder's death leaves nothing
 * open and the stale check can clean up after it.
 *
 * Resolves to a release function once the lock is held, or to `null` when the
 * lock cannot be taken at all (read-only directory, unsupported filesystem,
 * or a lock that stays held past `staleMs` even after being broken). Callers
 * fall back to running unlocked rather than failing.
 */
export async function acquireFileLock(
  lockPath: string,
  options: FileLockOptions = {}
): Promise<ReleaseLock | null> {
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS;
  // A live holder releases well within staleMs, and a dead one's lock is
  // broken once it is that old. Doubling it leaves room for lock churn while
  // still bounding the wait for callers.
  const deadline = Date.now() + staleMs * 2;

  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Already removed (e.g. broken as stale by a waiter); nothing to do.
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") return null;
    }

    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(lockPath).mtimeMs;
    } catch (error) {
      // Released between our open and stat: try again at once.
      if (errorCode(error) === "ENOENT") continue;
      return null;
    }

    if (Date.now() - mtimeMs > staleMs) {
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") return null;
      }
      continue;
    }

    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
  }
}
