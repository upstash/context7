import { describe, test, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { acquireFileLock } from "../utils/file-lock.js";

// Real filesystem: the lock's whole point is cross-process atomicity, which a
// mocked fs cannot show.
let dir: string;
let lockPath: string;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ageLock(ageMs: number): void {
  const then = new Date(Date.now() - ageMs);
  fs.utimesSync(lockPath, then, then);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx7-lock-"));
  lockPath = path.join(dir, "credentials.json.lock");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("acquireFileLock", () => {
  test("creates the lock file and release removes it", async () => {
    const release = await acquireFileLock(lockPath);
    expect(release).not.toBeNull();
    expect(fs.existsSync(lockPath)).toBe(true);
    release!();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("release is safe when the lock file is already gone", async () => {
    const release = await acquireFileLock(lockPath);
    fs.unlinkSync(lockPath);
    expect(() => release!()).not.toThrow();
  });

  test("concurrent acquirers take turns and never overlap", async () => {
    const held: Array<[number, number]> = [];
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const release = await acquireFileLock(lockPath, { pollMs: 5 });
        const from = Date.now();
        await sleep(15);
        held.push([from, Date.now()]);
        release!();
      })
    );

    held.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < held.length; i++) {
      expect(held[i][0]).toBeGreaterThanOrEqual(held[i - 1][1]);
    }
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test("a lock left by a crashed process is broken once it is stale", async () => {
    fs.writeFileSync(lockPath, "");
    ageLock(60_000);

    const started = Date.now();
    const release = await acquireFileLock(lockPath, { staleMs: 1_000, pollMs: 5 });

    expect(release).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    release!();
  });

  test("a fresh lock is waited for, not broken", async () => {
    fs.writeFileSync(lockPath, "");
    setTimeout(() => fs.unlinkSync(lockPath), 60);

    const started = Date.now();
    const release = await acquireFileLock(lockPath, { staleMs: 1_000, pollMs: 5 });

    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    release!();
  });

  // A refresh through a slow proxy can outlast the stale window. If a waiter
  // broke the lock then, it would refresh with a token the holder has already
  // sent, which is the very reuse the lock exists to prevent.
  test("a slow holder keeps its lock past staleMs", async () => {
    const staleMs = 90;
    const holder = await acquireFileLock(lockPath, { staleMs });
    const holderInode = fs.statSync(lockPath).ino;

    let waiterGotLockAt: number | undefined;
    const waiter = acquireFileLock(lockPath, { staleMs, pollMs: 5 }).then((release) => {
      waiterGotLockAt = Date.now();
      return release;
    });

    // Hold for several stale windows.
    await sleep(staleMs * 4);
    expect(waiterGotLockAt).toBeUndefined();
    // Still our file: the waiter did not replace it with its own.
    expect(fs.statSync(lockPath).ino).toBe(holderInode);

    const releasedAt = Date.now();
    holder!();
    const release = await waiter;
    expect(waiterGotLockAt).toBeGreaterThanOrEqual(releasedAt);
    release!();
  });

  test("the heartbeat stops at release", async () => {
    const release = await acquireFileLock(lockPath, { staleMs: 30 });
    release!();
    fs.writeFileSync(lockPath, "");
    const then = new Date(Date.now() - 5_000);
    fs.utimesSync(lockPath, then, then);

    await sleep(60);
    // A live heartbeat would have touched the file we recreated.
    expect(fs.statSync(lockPath).mtimeMs).toBeLessThan(Date.now() - 4_000);
  });

  test("returns null when the lock cannot be created", async () => {
    const missingDir = path.join(dir, "missing", "credentials.json.lock");
    expect(await acquireFileLock(missingDir)).toBeNull();
  });

  test("returns null when the directory is not writable", async () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    fs.chmodSync(dir, 0o500);
    try {
      expect(await acquireFileLock(lockPath)).toBeNull();
    } finally {
      fs.chmodSync(dir, 0o700);
    }
  });
});
