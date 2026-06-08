import * as fs from "fs";
import { access, chmod, mkdir, rename } from "fs/promises";
import * as os from "os";
import * as path from "path";

const APP_DIR = "context7";
const LEGACY_DIR = ".context7";

export const CREDENTIALS_FILE_NAME = "credentials.json";
export const UPDATE_STATE_FILE_NAME = "cli-state.json";
export const PREVIEWS_DIR_NAME = "previews";

// Per the XDG Base Directory Spec, a relative (or empty) value must be ignored
// and the default used instead.
function xdgBase(envVar: string, ...defaultSegments: string[]): string {
  const value = process.env[envVar];
  const base =
    value && path.isAbsolute(value) ? value : path.join(os.homedir(), ...defaultSegments);
  return path.join(base, APP_DIR);
}

export function getConfigDir(): string {
  return xdgBase("XDG_CONFIG_HOME", ".config");
}

export function getStateDir(): string {
  return xdgBase("XDG_STATE_HOME", ".local", "state");
}

export function getCacheDir(): string {
  return xdgBase("XDG_CACHE_HOME", ".cache");
}

export function getCredentialsFilePath(): string {
  return path.join(getConfigDir(), CREDENTIALS_FILE_NAME);
}

export function getUpdateStateFilePath(): string {
  return path.join(getStateDir(), UPDATE_STATE_FILE_NAME);
}

export function getPreviewsDir(): string {
  return path.join(getCacheDir(), PREVIEWS_DIR_NAME);
}

export function getLegacyFilePath(fileName: string): string {
  return path.join(os.homedir(), LEGACY_DIR, fileName);
}

/**
 * Best-effort move of a legacy `~/.context7/<file>` into its new XDG location.
 * `rename` preserves the source's permissions, so callers pass `mode` for
 * sensitive files (e.g. credentials) to re-assert a restrictive mode on the
 * migrated file. Failures (cross-device rename, permissions) are swallowed so
 * callers fall back to reading the legacy file rather than crashing.
 */
export function migrateLegacyFileSync(fileName: string, targetPath: string, mode?: number): void {
  const legacyPath = getLegacyFilePath(fileName);
  if (legacyPath === targetPath || fs.existsSync(targetPath) || !fs.existsSync(legacyPath)) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    fs.renameSync(legacyPath, targetPath);
    if (mode !== undefined) {
      fs.chmodSync(targetPath, mode);
    }
  } catch {
    // Leave the legacy file in place; readers resolve to it via resolveReadPathSync.
  }
}

export async function migrateLegacyFile(
  fileName: string,
  targetPath: string,
  mode?: number
): Promise<void> {
  const legacyPath = getLegacyFilePath(fileName);
  if (legacyPath === targetPath || (await exists(targetPath)) || !(await exists(legacyPath))) {
    return;
  }

  try {
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    await rename(legacyPath, targetPath);
    if (mode !== undefined) {
      await chmod(targetPath, mode);
    }
  } catch {
    // Leave the legacy file in place; readers resolve to it via resolveReadPath.
  }
}

/**
 * Returns the path to read from: the XDG target after attempting migration,
 * or the legacy path if migration could not complete and the legacy file
 * still exists. New writes should always target `targetPath`.
 */
export function resolveReadPathSync(fileName: string, targetPath: string, mode?: number): string {
  migrateLegacyFileSync(fileName, targetPath, mode);
  if (fs.existsSync(targetPath)) {
    return targetPath;
  }
  const legacyPath = getLegacyFilePath(fileName);
  return fs.existsSync(legacyPath) ? legacyPath : targetPath;
}

export async function resolveReadPath(
  fileName: string,
  targetPath: string,
  mode?: number
): Promise<string> {
  await migrateLegacyFile(fileName, targetPath, mode);
  if (await exists(targetPath)) {
    return targetPath;
  }
  const legacyPath = getLegacyFilePath(fileName);
  return (await exists(legacyPath)) ? legacyPath : targetPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
