import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { STDIO_PACKAGE } from "./agents.js";

interface TomlStringToken {
  value: string;
  start: number;
  end: number;
}

const TOML_BASIC_ESCAPES: Readonly<Record<string, string>> = {
  b: "\b",
  t: "\t",
  n: "\n",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};
const TRUSTED_STDIO_COMMANDS = new Set(["npx", "bunx", "pnpx"]);
const SAFE_STDIO_FLAGS = new Set(["-y", "--yes", "--debug"]);

function skipTomlArrayTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index++;
      continue;
    }
    if (source[index] !== "#") break;
    while (index < source.length && source[index] !== "\n") index++;
  }
  return index;
}

function parseTomlBasicString(source: string, start: number): TomlStringToken {
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const char = source[index++];
    if (char === '"') return { value, start, end: index };
    if (char === "\n" || char === "\r") {
      throw new Error("Multiline strings are not supported in MCP args");
    }
    if (char !== "\\") {
      value += char;
      continue;
    }

    const escape = source[index++];
    if (Object.hasOwn(TOML_BASIC_ESCAPES, escape)) {
      value += TOML_BASIC_ESCAPES[escape];
      continue;
    }
    if (escape !== "u" && escape !== "U") {
      throw new Error(`Unsupported TOML escape \\${escape}`);
    }

    const width = escape === "u" ? 4 : 8;
    const hex = source.slice(index, index + width);
    if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) {
      throw new Error(`Invalid TOML Unicode escape \\${escape}${hex}`);
    }
    const codePoint = Number.parseInt(hex, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error(`Invalid TOML Unicode code point U+${hex}`);
    }
    value += String.fromCodePoint(codePoint);
    index += width;
  }
  throw new Error("Unterminated TOML basic string in MCP args");
}

function parseTomlLiteralString(source: string, start: number): TomlStringToken {
  const endQuote = source.indexOf("'", start + 1);
  if (endQuote === -1) throw new Error("Unterminated TOML literal string in MCP args");
  const value = source.slice(start + 1, endQuote);
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Multiline strings are not supported in MCP args");
  }
  return { value, start, end: endQuote + 1 };
}

function parseTomlStringArray(
  source: string,
  start: number
): { tokens: TomlStringToken[]; end: number } {
  if (source[start] !== "[") throw new Error("Expected a TOML array for MCP args");

  const tokens: TomlStringToken[] = [];
  let index = start + 1;
  while (index < source.length) {
    index = skipTomlArrayTrivia(source, index);
    if (source[index] === "]") return { tokens, end: index + 1 };

    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      throw new Error("MCP args must be a TOML array containing only strings");
    }
    if (source.slice(index, index + 3) === quote.repeat(3)) {
      throw new Error("Multiline strings are not supported in MCP args");
    }

    const token =
      quote === '"' ? parseTomlBasicString(source, index) : parseTomlLiteralString(source, index);
    tokens.push(token);
    index = skipTomlArrayTrivia(source, token.end);

    if (source[index] === ",") {
      index++;
      continue;
    }
    if (source[index] !== "]") {
      throw new Error("Expected a comma or closing bracket in MCP args");
    }
  }
  throw new Error("Unterminated TOML array in MCP args");
}

function findTomlServerBody(
  raw: string,
  serverName: string
): { start: number; end: number } | null {
  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tableKey = `(?:mcp_servers|"mcp_servers"|'mcp_servers')`;
  const serverKey = `(?:${escapedName}|"${escapedName}"|'${escapedName}')`;
  const headerRe = new RegExp(
    `^[\\uFEFF\\t ]*\\[[\\t ]*${tableKey}[\\t ]*\\.[\\t ]*${serverKey}[\\t ]*\\][\\t ]*(?:#.*)?\\r?$`,
    "m"
  );
  const header = headerRe.exec(raw);
  if (!header) return null;

  const bodyStart = raw.indexOf("\n", header.index + header[0].length) + 1;
  const effectiveBodyStart = bodyStart === 0 ? raw.length : bodyStart;
  const nextHeaderRe = /^[\t ]*\[[^\r\n]+\][\t ]*(?:#.*)?\r?$/gm;
  nextHeaderRe.lastIndex = effectiveBodyStart;
  const nextHeader = nextHeaderRe.exec(raw);
  const bodyEnd = nextHeader?.index ?? raw.length;
  return { start: effectiveBodyStart, end: bodyEnd };
}

function findTomlServerArgs(
  raw: string,
  serverName: string
): {
  start: number;
  end: number;
  tokens: TomlStringToken[];
  bodyStart: number;
  bodyEnd: number;
} | null {
  const bodyRange = findTomlServerBody(raw, serverName);
  if (!bodyRange) return null;

  const body = raw.slice(bodyRange.start, bodyRange.end);
  const argsRe = /^[\t ]*(?:args|"args"|'args')[\t ]*=[\t ]*/gm;
  const args = argsRe.exec(body);
  if (!args) {
    throw new Error("Existing MCP server has no safely editable args array");
  }

  const start = bodyRange.start + args.index + args[0].length;
  const parsed = parseTomlStringArray(raw, start);
  return {
    start,
    end: parsed.end,
    tokens: parsed.tokens,
    bodyStart: bodyRange.start,
    bodyEnd: bodyRange.end,
  };
}

function withoutApiKey(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--api-key") {
      index++;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function isContext7Package(arg: string): boolean {
  if (arg === STDIO_PACKAGE) return true;
  if (!arg.startsWith(`${STDIO_PACKAGE}@`)) return false;
  const version = arg.slice(STDIO_PACKAGE.length + 1);
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version);
}

function findTomlServerCommand(raw: string, bodyStart: number, bodyEnd: number): string | null {
  const body = raw.slice(bodyStart, bodyEnd);
  const commandRe = /^[\t ]*(?:command|"command"|'command')[\t ]*=[\t ]*/gm;
  const command = commandRe.exec(body);
  if (!command) return null;

  const start = bodyStart + command.index + command[0].length;
  const quote = raw[start];
  if (quote !== '"' && quote !== "'") return null;
  if (raw.slice(start, start + 3) === quote.repeat(3)) return null;
  const token =
    quote === '"' ? parseTomlBasicString(raw, start) : parseTomlLiteralString(raw, start);
  const lineEnd = raw.indexOf("\n", token.end);
  const trailing = raw.slice(token.end, lineEnd === -1 ? bodyEnd : Math.min(lineEnd, bodyEnd));
  return /^[\t ]*(?:#.*)?\r?$/.test(trailing) ? token.value : null;
}

function sanitizeStdioArgs(args: string[], apiKey: string | undefined): string[] {
  const packageSpecifier = args.find(isContext7Package) ?? STDIO_PACKAGE;
  const runnerFlags = args.filter((arg) => arg === "-y" || arg === "--yes");
  const serverFlags = args.filter(
    (arg) => SAFE_STDIO_FLAGS.has(arg) && arg !== "-y" && arg !== "--yes"
  );
  const sanitized = [...runnerFlags, packageSpecifier, ...serverFlags];
  if (apiKey) sanitized.push("--api-key", apiKey);
  return sanitized;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function removeInlineServerEnv(raw: string, serverName: string): string {
  const bodyRange = findTomlServerBody(raw, serverName);
  if (!bodyRange) return raw;
  const body = raw.slice(bodyRange.start, bodyRange.end);
  const envRe = /^[\t ]*(?:env|"env"|'env')[\t ]*=.*(?:\r?\n|$)/gm;
  return raw.slice(0, bodyRange.start) + body.replace(envRe, "") + raw.slice(bodyRange.end);
}

function removeServerEnvTables(raw: string, serverName: string): string {
  const escapedName = serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const key = (value: string) => `(?:${value}|"${value}"|'${value}')`;
  const headerRe = new RegExp(
    `^[\\uFEFF\\t ]*\\[[\\t ]*${key("mcp_servers")}[\\t ]*\\.[\\t ]*${key(escapedName)}[\\t ]*\\.[\\t ]*${key("env")}[\\t ]*\\][\\t ]*(?:#.*)?\\r?$(?:\\n)?`,
    "gm"
  );

  let content = raw;
  let header = headerRe.exec(content);
  while (header) {
    const nextHeaderRe = /^[\t ]*\[[^\r\n]+\][\t ]*(?:#.*)?\r?$/gm;
    nextHeaderRe.lastIndex = header.index + header[0].length;
    const nextHeader = nextHeaderRe.exec(content);
    const end = nextHeader?.index ?? content.length;
    content = content.slice(0, header.index) + content.slice(end);
    headerRe.lastIndex = 0;
    header = headerRe.exec(content);
  }
  return content;
}

/**
 * Sanitizes an existing Context7 stdio TOML entry. Returns false when the
 * server is absent or its command is not a trusted package runner, allowing
 * setup to replace it with the canonical entry.
 */
export async function patchTomlStdioApiKey(
  filePath: string,
  serverName: string,
  apiKey: string | undefined
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return false;
  }

  if (raw.includes('"""') || raw.includes("'''")) {
    throw new Error("TOML files containing multiline strings are not safely editable");
  }

  const bodyRange = findTomlServerBody(raw, serverName);
  if (!bodyRange) return false;
  const command = findTomlServerCommand(raw, bodyRange.start, bodyRange.end);
  if (!command || !TRUSTED_STDIO_COMMANDS.has(command)) return false;
  const range = findTomlServerArgs(raw, serverName);
  if (!range) return false;

  const args = range.tokens.map((token) => token.value);
  if (!args.some(isContext7Package)) {
    throw new Error(`Existing MCP args do not invoke ${STDIO_PACKAGE}`);
  }

  const apiKeyIndexes = args.flatMap((arg, index) => (arg === "--api-key" ? [index] : []));
  let content: string;
  const sanitizedWithoutKey = sanitizeStdioArgs(args, undefined);
  if (
    apiKey &&
    apiKeyIndexes.length === 1 &&
    apiKeyIndexes[0] + 1 < range.tokens.length &&
    arraysEqual(withoutApiKey(args), sanitizedWithoutKey)
  ) {
    const valueToken = range.tokens[apiKeyIndexes[0] + 1];
    content = raw.slice(0, valueToken.start) + JSON.stringify(apiKey) + raw.slice(valueToken.end);
  } else {
    const patched = sanitizeStdioArgs(args, apiKey);
    content = raw.slice(0, range.start) + JSON.stringify(patched) + raw.slice(range.end);
  }

  content = removeInlineServerEnv(content, serverName);
  content = removeServerEnvTables(content, serverName);

  if (content !== raw) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  }
  return true;
}
