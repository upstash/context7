import * as fs from "fs";
import { access, mkdir, rename } from "fs/promises";
import * as os from "os";
import * as path from "path";

const APP_DIR = "context7";
const LEGACY_DIR = ".context7";

export const CREDENTIALS_FILE_NAME = "credentials.json";
export const UPDATE_STATE_FILE_NAME = "cli-state.json";

export function getConfigDir(): string {
  const configHome = process.env.XDG_CONFIG_HOME;
  return path.join(configHome || path.join(os.homedir(), ".config"), APP_DIR);
}

export function getStateDir(): string {
  const stateHome = process.env.XDG_STATE_HOME;
  return path.join(stateHome || path.join(os.homedir(), ".local", "state"), APP_DIR);
}

export function getCredentialsFilePath(): string {
  return path.join(getConfigDir(), CREDENTIALS_FILE_NAME);
}

export function getUpdateStateFilePath(): string {
  return path.join(getStateDir(), UPDATE_STATE_FILE_NAME);
}

export function getLegacyFilePath(fileName: string): string {
  return path.join(os.homedir(), LEGACY_DIR, fileName);
}

export function migrateLegacyFileSync(fileName: string, targetPath: string): void {
  const legacyPath = getLegacyFilePath(fileName);
  if (legacyPath === targetPath || fs.existsSync(targetPath) || !fs.existsSync(legacyPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  fs.renameSync(legacyPath, targetPath);
}

export async function migrateLegacyFile(fileName: string, targetPath: string): Promise<void> {
  const legacyPath = getLegacyFilePath(fileName);
  if (legacyPath === targetPath || (await exists(targetPath)) || !(await exists(legacyPath))) {
    return;
  }

  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  await rename(legacyPath, targetPath);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
