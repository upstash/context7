import { access, readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export async function readJsonConfig(filePath: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return {};
  }

  raw = raw.trim();
  if (!raw) return {};

  return JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
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

export async function resolveMcpPath(basePath: string): Promise<string> {
  if (basePath.endsWith(".json")) {
    const jsoncPath = basePath.replace(/\.json$/, ".jsonc");
    try {
      await access(jsoncPath);
      return jsoncPath;
    } catch {
      return basePath;
    }
  }
  return basePath;
}

export async function writeJsonConfig(
  filePath: string,
  config: Record<string, unknown>
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
