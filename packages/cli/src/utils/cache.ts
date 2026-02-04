import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";

const CACHE_DIR = join("node_modules", ".cache", "context7");
const PENDING_FILE = "pending.json";
const PENDING_TTL_MS = 20 * 60 * 1000; // 20 minutes

interface PendingPackage {
  name: string;
  detectedAt: number;
}

interface PendingCache {
  packages: PendingPackage[];
}

async function getCachePath(cwd: string): Promise<string> {
  const dir = join(cwd, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  return join(dir, PENDING_FILE);
}

export async function loadPendingPackages(cwd: string): Promise<string[]> {
  try {
    const cachePath = await getCachePath(cwd);
    const content = await readFile(cachePath, "utf-8");
    const cache: PendingCache = JSON.parse(content);
    const now = Date.now();
    const valid = cache.packages.filter((p) => now - p.detectedAt < PENDING_TTL_MS);
    return valid.map((p) => p.name);
  } catch {
    return [];
  }
}

export async function savePendingPackages(cwd: string, packages: string[]): Promise<void> {
  const cachePath = await getCachePath(cwd);
  const cache: PendingCache = {
    packages: packages.map((name) => ({
      name,
      detectedAt: Date.now(),
    })),
  };
  await writeFile(cachePath, JSON.stringify(cache, null, 2));
}

export async function clearPendingPackages(cwd: string): Promise<void> {
  try {
    const cachePath = await getCachePath(cwd);
    await rm(cachePath, { force: true });
  } catch {}
}

export async function appendPendingPackages(cwd: string, newPackages: string[]): Promise<void> {
  const existing = await loadPendingPackages(cwd);
  const merged = [...new Set([...existing, ...newPackages])];
  await savePendingPackages(cwd, merged);
}
