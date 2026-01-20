import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { C7Config } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";

const CONFIG_DIR = join(homedir(), ".config", "c7");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<C7Config> {
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(content) as Partial<C7Config>;
    return { ...DEFAULT_CONFIG, ...config };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: C7Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
