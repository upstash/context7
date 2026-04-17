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
  const alreadyExists = serverName in section;

  return {
    config: {
      ...existing,
      [configKey]: {
        ...section,
        [serverName]: entry,
      },
    },
    alreadyExists,
  };
}

export function removeServerEntry(
  existing: Record<string, unknown>,
  configKey: string,
  serverName: string
): { config: Record<string, unknown>; removed: boolean } {
  const section = existing[configKey];
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return { config: existing, removed: false };
  }

  const current = section as Record<string, unknown>;
  if (!(serverName in current)) {
    return { config: existing, removed: false };
  }

  const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== serverName));
  const next = { ...existing };

  if (Object.keys(rest).length === 0) {
    delete next[configKey];
  } else {
    next[configKey] = rest;
  }

  return { config: next, removed: true };
}

export async function resolveMcpPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return candidates[0];
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
  const block = buildTomlServerBlock(serverName, entry);

  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {}

  const sectionHeader = `[mcp_servers.${serverName}]`;
  const alreadyExists = existing.includes(sectionHeader);

  if (alreadyExists) {
    const subPrefix = `[mcp_servers.${serverName}.`;
    const startIdx = existing.indexOf(sectionHeader);
    const rest = existing.slice(startIdx + sectionHeader.length);

    let endOffset = rest.length;
    const re = /^\[/gm;
    let m;
    while ((m = re.exec(rest)) !== null) {
      const lineEnd = rest.indexOf("\n", m.index);
      const line = rest.slice(m.index, lineEnd === -1 ? undefined : lineEnd);
      if (!line.startsWith(subPrefix)) {
        endOffset = m.index;
        break;
      }
    }

    const rawBefore = existing.slice(0, startIdx).replace(/\n+$/, "");
    const rawAfter = existing
      .slice(startIdx + sectionHeader.length + endOffset)
      .replace(/^\n+/, "");
    const before = rawBefore.length > 0 ? rawBefore + "\n\n" : "";
    const after = rawAfter.length > 0 ? "\n" + rawAfter : "";
    const content = before + block + after;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  } else {
    const separator =
      existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, existing + separator + block, "utf-8");
  }

  return { alreadyExists };
}

export async function removeTomlServer(
  filePath: string,
  serverName: string
): Promise<{ removed: boolean }> {
  let existing = "";
  try {
    existing = await readFile(filePath, "utf-8");
  } catch {
    return { removed: false };
  }

  const sectionHeader = `[mcp_servers.${serverName}]`;
  const startIdx = existing.indexOf(sectionHeader);
  if (startIdx === -1) {
    return { removed: false };
  }

  const subPrefix = `[mcp_servers.${serverName}.`;
  const rest = existing.slice(startIdx + sectionHeader.length);

  let endOffset = rest.length;
  const re = /^\[/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rest)) !== null) {
    const lineEnd = rest.indexOf("\n", match.index);
    const line = rest.slice(match.index, lineEnd === -1 ? undefined : lineEnd);
    if (!line.startsWith(subPrefix)) {
      endOffset = match.index;
      break;
    }
  }

  const rawBefore = existing.slice(0, startIdx).replace(/\n+$/, "");
  const rawAfter = existing.slice(startIdx + sectionHeader.length + endOffset).replace(/^\n+/, "");
  const content = [rawBefore, rawAfter].filter(Boolean).join("\n\n");

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content.length > 0 ? `${content}\n` : "", "utf-8");
  return { removed: true };
}
