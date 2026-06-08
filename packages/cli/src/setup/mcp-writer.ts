import { access, readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { STDIO_PACKAGE } from "./agents.js";

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

/**
 * Reads the top-level `[mcp_servers.<serverName>]` block from a TOML config
 * file and parses its key-value lines into a JS object. Handles string and
 * array values (TOML array syntax is JSON-compatible). Sub-tables like
 * `[mcp_servers.<serverName>.http_headers]` are ignored. Returns undefined
 * if the file or section is missing.
 */
export async function readTomlServerEntry(
  filePath: string,
  serverName: string
): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }

  const sectionHeader = `[mcp_servers.${serverName}]`;
  const startIdx = raw.indexOf(sectionHeader);
  if (startIdx === -1) return undefined;

  // The top-level table's values live between its header and the next `[...]`
  // header (whether that's a sub-table like `[mcp_servers.foo.http_headers]`
  // or an unrelated section). Sub-table values belong to the sub-table, not
  // here, so excluding them is correct.
  const rest = raw.slice(startIdx + sectionHeader.length);
  const nextHeader = /^\[/m.exec(rest);
  const block = nextHeader ? rest.slice(0, nextHeader.index) : rest;

  const entry: Record<string, unknown> = {};
  const lineRe = /^([A-Za-z_][\w-]*)\s*=\s*(.+?)\s*$/gm;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = lineRe.exec(block)) !== null) {
    const [, key, valueText] = lineMatch;
    try {
      entry[key] = JSON.parse(valueText);
    } catch {
      // Skip values we can't parse as JSON (e.g., bare TOML numbers like 20)
    }
  }
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * True when `entry` looks like a stdio invocation of `@upstash/context7-mcp`
 * (either `command: "npx", args: [..., "@upstash/context7-mcp", ...]` or
 * OpenCode-style `command: ["npx", ..., "@upstash/context7-mcp", ...]`).
 */
export function isStdioContext7Entry(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  const refs = (s: unknown) => typeof s === "string" && s.includes(STDIO_PACKAGE);

  if (Array.isArray(e.command)) {
    return (e.command as unknown[]).some(refs);
  }
  if (typeof e.command === "string" && Array.isArray(e.args)) {
    return (e.args as unknown[]).some(refs);
  }
  return false;
}

/**
 * Extracts an existing per-server entry from an in-memory JSON config
 * (e.g., the object returned by `readJsonConfig`). Returns `undefined`
 * when the section, server, or entry shape is missing.
 */
export function getJsonServerEntry(
  config: Record<string, unknown>,
  configKey: string,
  serverName: string
): Record<string, unknown> | undefined {
  const section = config[configKey];
  if (!section || typeof section !== "object") return undefined;
  const entry = (section as Record<string, unknown>)[serverName];
  return entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined;
}

function stripApiKeyPair(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api-key") {
      i++; // skip the value too
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

/**
 * Returns a copy of `entry` with any existing `--api-key <value>` pair
 * removed from args (or array-form command), then a new `--api-key <apiKey>`
 * appended when `apiKey` is provided. All other fields — including the
 * package specifier (e.g., `@upstash/context7-mcp@latest`) — are preserved.
 */
export function patchStdioApiKey(
  entry: Record<string, unknown>,
  apiKey: string | undefined
): Record<string, unknown> {
  if (Array.isArray(entry.command)) {
    const cmd = stripApiKeyPair(entry.command as string[]);
    if (apiKey) cmd.push("--api-key", apiKey);
    return { ...entry, command: cmd };
  }
  const args = Array.isArray(entry.args) ? stripApiKeyPair(entry.args as string[]) : [];
  if (apiKey) args.push("--api-key", apiKey);
  return { ...entry, args };
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
