import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { isDeepStrictEqual } from "util";
import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOpenCodeConfig(source: string, filePath: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const config: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `Could not parse ${filePath}: ${printParseErrorCode(first.error)} at offset ${first.offset}`
    );
  }
  if (!isConfigObject(config)) {
    throw new Error(`Expected a configuration object in ${filePath}`);
  }
  if (config.mcp !== undefined && !isConfigObject(config.mcp)) {
    throw new Error(`Expected an MCP object in ${filePath}`);
  }
  return config;
}

async function readOpenCodeSource(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readOpenCodeConfig(filePath: string): Promise<Record<string, unknown>> {
  const source = await readOpenCodeSource(filePath);
  return source === undefined ? {} : parseOpenCodeConfig(source, filePath);
}

// Delete only the property/item and its separator, not neighboring comments.
// modify() may consume trivia after a property or leave a dangling comma in
// an otherwise empty object when the original had a trailing comma.
function removeOpenCodeValue(source: string, path: JSONPath): string {
  const root = parseTree(source, [], { allowTrailingComma: true });
  const value = root && findNodeAtLocation(root, path);
  if (!value) return source;
  const node = value.parent?.type === "property" ? value.parent : value;
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  const scanner = createScanner(source, true);
  scanner.setPosition(node.offset + node.length);
  const edits = [{ offset: node.offset, length: node.length, content: "" }];
  if (scanner.scan() === SyntaxKind.CommaToken) {
    edits.push({ offset: scanner.getTokenOffset(), length: 1, content: "" });
  } else if (index > 0) {
    const previous = siblings[index - 1];
    scanner.setPosition(previous.offset + previous.length);
    if (scanner.scan() === SyntaxKind.CommaToken) {
      edits.unshift({ offset: scanner.getTokenOffset(), length: 1, content: "" });
    }
  }
  return applyEdits(source, edits);
}

// Recurse through existing containers so changing a value does not replace the
// comments and trailing commas belonging to the rest of that container.
function editOpenCodeValue(
  source: string,
  path: JSONPath,
  previous: unknown,
  next: unknown
): string {
  if (isDeepStrictEqual(previous, next)) return source;
  if (next === undefined) return removeOpenCodeValue(source, path);
  if (isConfigObject(previous) && isConfigObject(next)) {
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      source = editOpenCodeValue(
        source,
        [...path, key],
        Object.hasOwn(previous, key) ? previous[key] : undefined,
        Object.hasOwn(next, key) ? next[key] : undefined
      );
    }
    return source;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    for (let index = previous.length - 1; index >= next.length; index--) {
      source = removeOpenCodeValue(source, [...path, index]);
    }
    for (let index = 0; index < next.length; index++) {
      source = editOpenCodeValue(source, [...path, index], previous[index], next[index]);
    }
    return source;
  }
  return applyEdits(source, modify(source, path, next, {}));
}

/** A synchronous resolver keeps entry construction tied to the text being edited. */
export async function updateOpenCodeServer(
  filePath: string,
  resolveEntry: (
    existing: Record<string, unknown> | undefined
  ) => Record<string, unknown> | undefined
): Promise<{ alreadyExists: boolean; removed: boolean }> {
  const originalSource = await readOpenCodeSource(filePath);
  const source = originalSource ?? "{}\n";
  const config = parseOpenCodeConfig(source, filePath);
  const servers = (config.mcp as Record<string, unknown> | undefined) ?? {};
  const alreadyExists = Object.hasOwn(servers, "context7");
  const previous = servers.context7;
  const next = resolveEntry(isConfigObject(previous) ? previous : undefined);
  // Keep an empty MCP object on removal: it may contain user comments.
  const updated = editOpenCodeValue(source, ["mcp", "context7"], previous, next);
  if (updated !== source) {
    const updatedConfig = parseOpenCodeConfig(updated, filePath);
    const updatedServers = updatedConfig.mcp as Record<string, unknown>;
    if (!isDeepStrictEqual(updatedServers.context7, next)) {
      throw new Error(`Could not safely update Context7 in ${filePath}; check for duplicate keys`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    if ((await readOpenCodeSource(filePath)) !== originalSource) {
      throw new Error(`Configuration changed while editing ${filePath}; please retry`);
    }
    await writeFile(filePath, updated, "utf-8");
  }
  return { alreadyExists, removed: alreadyExists && next === undefined };
}
