import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export async function readJsonConfig(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return {};
  }

  raw = raw.trim();
  if (!raw) return {};

  return JSON.parse(raw) as Record<string, unknown>;
}

export function mergeServerEntry(
  existing: Record<string, unknown>,
  configKey: string,
  serverName: string,
  entry: Record<string, unknown>
): { config: Record<string, unknown>; alreadyExists: boolean } {
  const section = (existing[configKey] as Record<string, unknown> | undefined) ?? {};

  if (serverName in section) {
    return { config: existing, alreadyExists: true };
  }

  return {
    config: {
      ...existing,
      [configKey]: {
        ...section,
        [serverName]: entry,
      },
    },
    alreadyExists: false,
  };
}

export function mergeInstructions(
  config: Record<string, unknown>,
  glob: string
): Record<string, unknown> {
  const instructions = (config.instructions as string[] | undefined) ?? [];
  if (instructions.includes(glob)) return config;
  return { ...config, instructions: [...instructions, glob] };
}

export async function writeJsonConfig(
  filePath: string,
  config: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
