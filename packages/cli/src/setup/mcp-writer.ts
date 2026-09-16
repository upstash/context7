import { access, readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { STDIO_PACKAGE } from "./agents.js";

export { patchTomlStdioApiKey } from "./toml-editor.js";

const TRUSTED_STDIO_COMMANDS = new Set(["npx", "bunx", "pnpx"]);
const SAFE_STDIO_FLAGS = new Set(["-y", "--yes", "--debug"]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isContext7PackageSpecifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === STDIO_PACKAGE) return true;
  if (!value.startsWith(`${STDIO_PACKAGE}@`)) return false;

  const version = value.slice(STDIO_PACKAGE.length + 1);
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version);
}

function sanitizeStdioArgs(args: string[], apiKey: string | undefined): string[] {
  const packageSpecifier = args.find(isContext7PackageSpecifier) ?? STDIO_PACKAGE;
  const runnerFlags = args.filter((arg) => arg === "-y" || arg === "--yes");
  const serverFlags = args.filter(
    (arg) => SAFE_STDIO_FLAGS.has(arg) && arg !== "-y" && arg !== "--yes"
  );
  const sanitized = [...runnerFlags, packageSpecifier, ...serverFlags];
  if (apiKey) sanitized.push("--api-key", apiKey);
  return sanitized;
}

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
 * True when `entry` looks like a stdio invocation of `@upstash/context7-mcp`
 * (either `command: "npx", args: [..., "@upstash/context7-mcp", ...]` or
 * OpenCode-style `command: ["npx", ..., "@upstash/context7-mcp", ...]`).
 */
export function isStdioContext7Entry(entry: unknown): entry is Record<string, unknown> {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const candidate = entry as Record<string, unknown>;

  if (isStringArray(candidate.command)) {
    const [command, ...args] = candidate.command;
    return TRUSTED_STDIO_COMMANDS.has(command) && args.some(isContext7PackageSpecifier);
  }
  return (
    typeof candidate.command === "string" &&
    TRUSTED_STDIO_COMMANDS.has(candidate.command) &&
    isStringArray(candidate.args) &&
    candidate.args.some(isContext7PackageSpecifier)
  );
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

/**
 * Rebuilds a recognized stdio entry from its agent's canonical shape and
 * carries over only the trusted runner, Context7 package specifier, safe
 * flags, and OpenCode's type/enabled fields.
 */
export function patchStdioApiKey(
  entry: Record<string, unknown>,
  apiKey: string | undefined,
  canonicalEntry?: Record<string, unknown>
): Record<string, unknown> {
  if (isStringArray(entry.command)) {
    const [command, ...args] = entry.command;
    const canonical = canonicalEntry ?? { type: "local", command: [], enabled: true };
    const patched: Record<string, unknown> = { ...canonical };
    if ("type" in entry) patched.type = entry.type;
    patched.command = [command, ...sanitizeStdioArgs(args, apiKey)];
    if ("enabled" in entry) patched.enabled = entry.enabled;
    return patched;
  }

  const canonical = canonicalEntry ?? { command: "npx", args: ["-y", STDIO_PACKAGE] };
  const command =
    typeof entry.command === "string" && TRUSTED_STDIO_COMMANDS.has(entry.command)
      ? entry.command
      : "npx";
  const args = isStringArray(entry.args) ? entry.args : ["-y", STDIO_PACKAGE];
  return { ...canonical, command, args: sanitizeStdioArgs(args, apiKey) };
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
