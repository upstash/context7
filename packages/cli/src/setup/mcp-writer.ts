import { access, readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

function stripJsonComments(text: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") i++;
        i++;
      }
      result += text.slice(start, ++i);
    } else if (text[i] === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += text[i++];
    }
  }
  return result;
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

export async function readTomlServerExists(filePath: string, serverName: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return raw.includes(`[mcp_servers.${serverName}]`);
  } catch {
    return false;
  }
}

export function buildTomlServerBlock(serverName: string, entry: Record<string, unknown>): string {
  const lines: string[] = [`[mcp_servers.${serverName}]`];
  const headers = entry.headers as Record<string, string> | undefined;

  for (const [key, value] of Object.entries(entry)) {
    if (key === "headers") continue;
    lines.push(`${key} = ${JSON.stringify(value)}`);
  }

  if (headers && Object.keys(headers).length > 0) {
    lines.push("");
    lines.push(`[mcp_servers.${serverName}.http_headers]`);
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  return lines.join("\n") + "\n";
}

export async function appendTomlServer(
  filePath: string,
  serverName: string,
  entry: Record<string, unknown>
): Promise<{ alreadyExists: boolean }> {
  if (await readTomlServerExists(filePath, serverName)) {
    return { alreadyExists: true };
  }

  const block = buildTomlServerBlock(serverName, entry);

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist
  }

  const separator =
    existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, existing + separator + block, "utf-8");
  return { alreadyExists: false };
}
