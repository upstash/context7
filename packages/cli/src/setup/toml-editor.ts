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

type TomlMultilineDelimiter = '"""' | "'''";

interface TomlCodeLine {
  start: number;
  text: string;
}

interface TomlTableHeader extends TomlCodeLine {
  keys: string[];
}

function skipTomlKeyWhitespace(source: string, start: number): number {
  let index = start;
  while (source[index] === " " || source[index] === "\t") index++;
  return index;
}

function parseTomlKeySegment(
  source: string,
  start: number
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote === '"' || quote === "'") {
    try {
      return quote === '"'
        ? parseTomlBasicString(source, start)
        : parseTomlLiteralString(source, start);
    } catch {
      return undefined;
    }
  }

  const bareKey = /^[A-Za-z0-9_-]+/.exec(source.slice(start));
  return bareKey ? { value: bareKey[0], end: start + bareKey[0].length } : undefined;
}

function parseTomlTableHeader(line: string): string[] | undefined {
  let index = skipTomlKeyWhitespace(line, line.charCodeAt(0) === 0xfeff ? 1 : 0);
  if (line[index] !== "[" || line[index + 1] === "[") return undefined;
  index = skipTomlKeyWhitespace(line, index + 1);

  const keys: string[] = [];
  while (index < line.length) {
    const key = parseTomlKeySegment(line, index);
    if (!key) return undefined;
    keys.push(key.value);
    index = skipTomlKeyWhitespace(line, key.end);

    if (line[index] === ".") {
      index = skipTomlKeyWhitespace(line, index + 1);
      continue;
    }
    if (line[index] !== "]") return undefined;

    index = skipTomlKeyWhitespace(line, index + 1);
    if (line[index] === "\r") index++;
    return index === line.length || line[index] === "#" ? keys : undefined;
  }
  return undefined;
}

function findTomlValueStart(line: string, keyName: string): number | undefined {
  let index = skipTomlKeyWhitespace(line, 0);
  const key = parseTomlKeySegment(line, index);
  if (!key || key.value !== keyName) return undefined;
  index = skipTomlKeyWhitespace(line, key.end);
  if (line[index] !== "=") return undefined;
  return skipTomlKeyWhitespace(line, index + 1);
}

function isEscapedTomlQuote(line: string, quoteIndex: number): boolean {
  let backslashes = 0;
  for (let index = quoteIndex - 1; index >= 0 && line[index] === "\\"; index--) backslashes++;
  return backslashes % 2 === 1;
}

function advanceTomlMultilineState(
  line: string,
  initial: TomlMultilineDelimiter | undefined
): TomlMultilineDelimiter | undefined {
  let multiline = initial;
  let index = 0;

  while (index < line.length) {
    if (multiline) {
      const delimiterIndex = line.indexOf(multiline, index);
      if (delimiterIndex === -1) return multiline;
      if (multiline === '"""' && isEscapedTomlQuote(line, delimiterIndex)) {
        index = delimiterIndex + 1;
        continue;
      }
      multiline = undefined;
      index = delimiterIndex + 3;
      continue;
    }

    if (line[index] === "#") return undefined;
    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      multiline = line.slice(index, index + 3) as TomlMultilineDelimiter;
      index += 3;
      continue;
    }
    if (line[index] === '"') {
      index++;
      while (index < line.length && line[index] !== '"') {
        index += line[index] === "\\" ? 2 : 1;
      }
      index++;
      continue;
    }
    if (line[index] === "'") {
      const endQuote = line.indexOf("'", index + 1);
      index = endQuote === -1 ? line.length : endQuote + 1;
      continue;
    }
    index++;
  }

  return multiline;
}

function findTomlCodeLines(source: string, start = 0, end = source.length): TomlCodeLine[] {
  const lines: TomlCodeLine[] = [];
  let multiline: TomlMultilineDelimiter | undefined;
  let lineStart = start;

  while (lineStart < end) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 || newline >= end ? end : newline;
    const text = source.slice(lineStart, lineEnd);
    if (!multiline) lines.push({ start: lineStart, text });
    multiline = advanceTomlMultilineState(text, multiline);
    if (newline === -1 || newline >= end) break;
    lineStart = newline + 1;
  }

  if (multiline) throw new Error("Unterminated TOML multiline string");
  return lines;
}

function findTomlTableHeaders(source: string): TomlTableHeader[] {
  return findTomlCodeLines(source).flatMap((line) => {
    const keys = parseTomlTableHeader(line.text);
    return keys ? [{ ...line, keys }] : [];
  });
}

function classifyTomlServerHeader(
  header: TomlTableHeader,
  serverName: string
): "server" | "subtable" | undefined {
  if (header.keys[0] !== "mcp_servers" || header.keys[1] !== serverName) return undefined;
  return header.keys.length === 2 ? "server" : "subtable";
}

export function findTomlServerSection(
  source: string,
  serverName: string
): { start: number; end: number } | undefined {
  let start: number | undefined;

  for (const header of findTomlTableHeaders(source)) {
    const kind = classifyTomlServerHeader(header, serverName);
    if (start === undefined) {
      if (kind === "server") start = header.start;
      continue;
    }
    if (kind !== "subtable") return { start, end: header.start };
  }

  return start === undefined ? undefined : { start, end: source.length };
}

function findTomlServerArgs(
  raw: string,
  serverName: string
): { start: number; end: number; tokens: TomlStringToken[] } | null {
  const headers = findTomlTableHeaders(raw);
  const headerIndex = headers.findIndex(
    (header) => classifyTomlServerHeader(header, serverName) === "server"
  );
  if (headerIndex === -1) return null;

  const header = headers[headerIndex];
  const bodyStart = raw.indexOf("\n", header.start + header.text.length) + 1;
  const effectiveBodyStart = bodyStart === 0 ? raw.length : bodyStart;
  const bodyEnd = headers[headerIndex + 1]?.start ?? raw.length;
  const args = findTomlCodeLines(raw, effectiveBodyStart, bodyEnd)
    .map((line) => ({ line, valueStart: findTomlValueStart(line.text, "args") }))
    .find(({ valueStart }) => valueStart !== undefined);
  if (!args || args.valueStart === undefined) {
    throw new Error("Existing MCP server has no safely editable args array");
  }

  const start = args.line.start + args.valueStart;
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
