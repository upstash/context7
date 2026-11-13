import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { applyEdits, modify, type JSONPath } from "jsonc-parser";
import { parseJsonConfig } from "./mcp-writer.js";

const options = { formattingOptions: { tabSize: 2, insertSpaces: true } };
const SERVER_NAME = "context7";

/**
 * OpenCode 1.x keeps servers at `mcp.<name>` with `enabled`. OpenCode 2.x keeps
 * them at `mcp.servers.<name>` with `disabled`, and still reads the 1.x layout.
 * OpenCode 1.x rejects a config that has `mcp.servers`.
 */
type Layout = "v1" | "v2";

const SERVER_PARENT: Record<Layout, JSONPath> = {
  v1: ["mcp"],
  v2: ["mcp", "servers"],
};

type Entry = Record<string, unknown>;

function isObject(value: unknown): value is Entry {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getAt(config: unknown, path: JSONPath): unknown {
  return path.reduce<unknown>(
    (node, key) => (isObject(node) ? node[key as string] : undefined),
    config
  );
}

/**
 * Follows the layout the file already uses. Only a config that already has a
 * 2.x server map gets the 2.x layout, because the 1.x layout works on both
 * versions. A 1.x server always has a string `type`, so a `mcp.servers` object
 * without one is a 2.x server map.
 */
function getLayout(config: Entry): Layout {
  const servers = getAt(config, SERVER_PARENT.v2);
  return isObject(servers) && typeof servers.type !== "string" ? "v2" : "v1";
}

/** Converts a 1.x entry to the 2.x layout, where `disabled` replaces `enabled`. */
function toLayout(entry: Entry, layout: Layout): Entry {
  if (layout === "v1" || !("enabled" in entry)) return entry;
  const { enabled, ...rest } = entry;
  return enabled === false ? { ...rest, disabled: true } : rest;
}

/** Finds an existing Context7 entry in either layout, 2.x first. */
function findServer(config: Entry): Entry | undefined {
  for (const parent of [SERVER_PARENT.v2, SERVER_PARENT.v1]) {
    const entry = getAt(config, [...parent, SERVER_NAME]);
    if (isObject(entry)) return entry;
  }
  return undefined;
}

export function hasOpenCodeServer(config: Entry): boolean {
  return [SERVER_PARENT.v2, SERVER_PARENT.v1].some((parent) => {
    const section = getAt(config, parent);
    return isObject(section) && SERVER_NAME in section;
  });
}

/** Removes the Context7 entry of one layout from `text`, which `config` was parsed from. */
function removeServer(text: string, config: Entry, layout: Layout): string {
  const parent = SERVER_PARENT[layout];
  const section = getAt(config, parent);
  if (!isObject(section) || !(SERVER_NAME in section)) return text;

  // modify() leaves `{ , }` when it deletes the only property of an object that
  // has a trailing comma, so empty the parent object instead.
  const edits =
    Object.keys(section).join() === SERVER_NAME
      ? modify(text, parent, {}, options)
      : modify(text, [...parent, SERVER_NAME], undefined, options);
  return applyEdits(text, edits);
}

/** Reads the file once. Throws on invalid JSON so the file is reported instead of edited. */
async function readConfigFile(filePath: string): Promise<{ text: string; config: Entry }> {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const config = parseJsonConfig(raw);
  return { text: raw.trim() ? raw : "{}\n", config: isObject(config) ? config : {} };
}

async function writeConfigFile(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf-8");
}

/**
 * Writes the Context7 entry in the layout the file already uses. `buildEntry`
 * gets the existing Context7 entry, if any, and returns a 1.x entry. Edits the
 * file text in place, so comments and trailing commas outside the entry survive.
 * In the 2.x layout it also drops a `mcp.context7` entry that earlier CLI
 * versions wrote, so the file has one Context7 entry. Returns true when a
 * Context7 entry already existed.
 */
export async function writeOpenCodeServer(
  filePath: string,
  buildEntry: (existing: Entry | undefined) => Entry
): Promise<boolean> {
  const { text, config } = await readConfigFile(filePath);
  const layout = getLayout(config);
  const entry = toLayout(buildEntry(findServer(config)), layout);

  const cleaned = layout === "v2" ? removeServer(text, config, "v1") : text;
  const path = [...SERVER_PARENT[layout], SERVER_NAME];
  await writeConfigFile(filePath, applyEdits(cleaned, modify(cleaned, path, entry, options)));
  return hasOpenCodeServer(config);
}

/** Removes the Context7 entry from both layouts. Returns true when one was removed. */
export async function removeOpenCodeServer(filePath: string): Promise<boolean> {
  const { text, config } = await readConfigFile(filePath);
  if (!hasOpenCodeServer(config)) return false;

  // Removing the 2.x entry leaves the keys of `mcp` unchanged, so `config` stays
  // valid for the 1.x pass.
  const v2Removed = removeServer(text, config, "v2");
  await writeConfigFile(filePath, removeServer(v2Removed, config, "v1"));
  return true;
}
