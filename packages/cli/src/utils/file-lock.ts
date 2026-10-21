import * as fs from "fs";

/** Releases the lock. Safe to call if the lock file is already gone. */
export type ReleaseLock = () => void;

export interface FileLockOptions {
  /**
   * A lock file not touched for this long is treated as left behind by a
   * process that died without releasing it, and is removed so no command
   * hangs on it. A live holder touches its lock well within this window.
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
 * While held, the lock's mtime is touched every `staleMs / 3` so that only a
 * dead holder's lock ever looks stale. A holder that is merely slow (a token
 * request through a proxy, a cold server) keeps the lock, and waiters keep
 * waiting; breaking it would let them repeat the work the holder is in the
 * middle of. The wait is therefore bounded by the holder's lifetime plus
 * `staleMs`, never by a fixed deadline.
 *
 * Resolves to a release function once the lock is held, or to `null` when the
 * lock cannot be taken at all (read-only directory, unsupported filesystem).
 * Callers fall back to running unlocked rather than failing.
 */
export async function acquireFileLock(
  lockPath: string,
  options: FileLockOptions = {}
): Promise<ReleaseLock | null> {
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS;

  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, "wx", 0o600));
      return holdLock(lockPath, staleMs);
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

    await sleep(pollMs);
  }
}

function holdLock(lockPath: string, staleMs: number): ReleaseLock {
  const heartbeat = setInterval(
    () => {
      try {
        const now = new Date();
        fs.utimesSync(lockPath, now, now);
      } catch {
        // The lock is gone (broken as stale on a frozen machine, or the
        // directory was removed). Nothing to keep fresh; release copes.
      }
    },
    Math.max(1, Math.floor(staleMs / 3))
  );
  // Never keep the process alive just to touch the lock.
  heartbeat.unref();

  return () => {
    clearInterval(heartbeat);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Already removed; nothing to do.
    }
  };
}
