import { execFile } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser";

const options = { formattingOptions: { tabSize: 2, insertSpaces: true } };
const SERVER_NAME = "context7";

/**
 * OpenCode 1.x keeps servers at `mcp.<name>`. OpenCode 2.x keeps them at
 * `mcp.servers.<name>` and replaces the `enabled` field with `disabled`.
 */
export type OpenCodeLayout = "v1" | "v2";

const SERVER_PARENT: Record<OpenCodeLayout, JSONPath> = {
  v1: ["mcp"],
  v2: ["mcp", "servers"],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getAt(config: unknown, path: JSONPath): unknown {
  return path.reduce<unknown>(
    (node, key) => (isObject(node) ? node[key as string] : undefined),
    config
  );
}

function parseText(text: string): Record<string, unknown> {
  const config = parse(text.trim() || "{}", [], { allowTrailingComma: true });
  return isObject(config) ? config : {};
}

/**
 * Reads the layout from the servers a config already has. A 1.x server entry
 * always has a string `type`, so a `mcp.servers` object without one is a 2.x
 * server map. Returns undefined when the config has no servers to go by.
 */
export function detectOpenCodeLayout(config: Record<string, unknown>): OpenCodeLayout | undefined {
  const mcp = config.mcp;
  if (!isObject(mcp)) return undefined;
  if (isObject(mcp.servers) && typeof mcp.servers.type !== "string") return "v2";
  const hasV1Server = Object.values(mcp).some(
    (value) => isObject(value) && typeof value.type === "string"
  );
  return hasV1Server ? "v1" : undefined;
}

/** Returns the major version of the installed `opencode` binary, if any. */
export function getInstalledOpenCodeMajor(): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        "opencode",
        ["--version"],
        { timeout: 3000, shell: process.platform === "win32" },
        (error, stdout) => {
          const match = error ? null : /(\d+)\.\d+/.exec(String(stdout));
          resolve(match ? Number(match[1]) : undefined);
        }
      );
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Picks the layout to write. The config shape wins; for a config without
 * servers, the installed OpenCode version decides. Without either, keep the
 * 1.x layout that earlier CLI versions wrote.
 */
export async function resolveOpenCodeLayout(
  config: Record<string, unknown>,
  getMajor: () => Promise<number | undefined> = getInstalledOpenCodeMajor
): Promise<OpenCodeLayout> {
  const fromConfig = detectOpenCodeLayout(config);
  if (fromConfig) return fromConfig;
  const major = await getMajor();
  return major !== undefined && major >= 2 ? "v2" : "v1";
}

/** Converts a 1.x-shaped entry to the given layout. */
export function toOpenCodeEntry(
  entry: Record<string, unknown>,
  layout: OpenCodeLayout
): Record<string, unknown> {
  if (layout === "v1" || !("enabled" in entry)) return entry;
  const { enabled, ...rest } = entry;
  return enabled === false ? { ...rest, disabled: true } : rest;
}

/** Finds an existing Context7 entry in either layout, 2.x first. */
export function getOpenCodeServerEntry(
  config: Record<string, unknown>
): Record<string, unknown> | undefined {
  for (const parent of [SERVER_PARENT.v2, SERVER_PARENT.v1]) {
    const entry = getAt(config, [...parent, SERVER_NAME]);
    if (isObject(entry)) return entry;
  }
  return undefined;
}

export function hasOpenCodeServer(config: Record<string, unknown>): boolean {
  return [SERVER_PARENT.v2, SERVER_PARENT.v1].some((parent) => {
    const section = getAt(config, parent);
    return isObject(section) && SERVER_NAME in section;
  });
}

function removeServer(text: string, layout: OpenCodeLayout): { text: string; removed: boolean } {
  const parent = SERVER_PARENT[layout];
  const section = getAt(parseText(text), parent);
  if (!isObject(section) || !(SERVER_NAME in section)) return { text, removed: false };

  // modify() leaves `{ , }` when it deletes the only property of an object that
  // has a trailing comma, so empty the parent object instead.
  const edits =
    Object.keys(section).join() === SERVER_NAME
      ? modify(text, parent, {}, options)
      : modify(text, [...parent, SERVER_NAME], undefined, options);
  return { text: applyEdits(text, edits), removed: true };
}

async function readSource(filePath: string): Promise<string> {
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  return raw.trim() ? raw : "{}\n";
}

async function writeSource(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf-8");
}

/**
 * Writes the Context7 entry for the given layout. Edits the file text in place,
 * so comments and trailing commas outside the entry survive. For 2.x it also
 * drops a `mcp.context7` entry left by earlier CLI versions, which 2.x does not
 * read. Returns true when a Context7 entry already existed.
 */
export async function writeOpenCodeServer(
  filePath: string,
  entry: Record<string, unknown>,
  layout: OpenCodeLayout
): Promise<boolean> {
  let text = await readSource(filePath);
  const alreadyExists = hasOpenCodeServer(parseText(text));

  if (layout === "v2") text = removeServer(text, "v1").text;
  text = applyEdits(text, modify(text, [...SERVER_PARENT[layout], SERVER_NAME], entry, options));

  await writeSource(filePath, text);
  return alreadyExists;
}

/** Removes the Context7 entry from both layouts. Returns true when one was removed. */
export async function removeOpenCodeServer(filePath: string): Promise<boolean> {
  let text = await readSource(filePath);
  let removed = false;
  for (const layout of ["v2", "v1"] as const) {
    const result = removeServer(text, layout);
    text = result.text;
    removed ||= result.removed;
  }
  if (removed) await writeSource(filePath, text);
  return removed;
}
