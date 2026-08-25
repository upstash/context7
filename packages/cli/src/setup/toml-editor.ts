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

function findTomlServerArgs(
  raw: string,
  serverName: string
): { start: number; end: number; tokens: TomlStringToken[] } | null {
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

  const body = raw.slice(effectiveBodyStart, bodyEnd);
  const argsRe = /^[\t ]*(?:args|"args"|'args')[\t ]*=[\t ]*/gm;
  const args = argsRe.exec(body);
  if (!args) {
    throw new Error("Existing MCP server has no safely editable args array");
  }

  const start = effectiveBodyStart + args.index + args[0].length;
  const parsed = parseTomlStringArray(raw, start);
  return { start, end: parsed.end, tokens: parsed.tokens };
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
  return arg === STDIO_PACKAGE || arg.startsWith(`${STDIO_PACKAGE}@`);
}

/**
 * Updates only the `args` value of an existing Context7 stdio TOML entry.
 * Every other byte in the config is preserved. Unsupported `args` syntax
 * throws instead of allowing setup to replace a configuration it cannot read.
 * Returns false only when the requested server table is absent.
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

  const range = findTomlServerArgs(raw, serverName);
  if (!range) return false;

  const args = range.tokens.map((token) => token.value);
  if (!args.some(isContext7Package)) {
    throw new Error(`Existing MCP args do not invoke ${STDIO_PACKAGE}`);
  }

  const apiKeyIndexes = args.flatMap((arg, index) => (arg === "--api-key" ? [index] : []));
  let content: string;
  if (apiKey && apiKeyIndexes.length === 1 && apiKeyIndexes[0] + 1 < range.tokens.length) {
    const valueToken = range.tokens[apiKeyIndexes[0] + 1];
    content = raw.slice(0, valueToken.start) + JSON.stringify(apiKey) + raw.slice(valueToken.end);
  } else {
    const patched = withoutApiKey(args);
    if (apiKey) patched.push("--api-key", apiKey);
    content = raw.slice(0, range.start) + JSON.stringify(patched) + raw.slice(range.end);
  }

  if (content !== raw) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
  }
  return true;
}
