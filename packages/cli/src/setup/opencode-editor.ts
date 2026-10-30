import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { applyEdits, modify } from "jsonc-parser";
import { readJsonConfig } from "./mcp-writer.js";

const options = { formattingOptions: { tabSize: 2, insertSpaces: true } };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * OpenCode v2 keeps MCP servers under `mcp.servers`, while v1 puts them directly
 * under `mcp`. A config is treated as v2 when `mcp.servers` is an object that is
 * not itself a v1 server entry (those always have a `type`).
 */
export function usesOpenCodeServersKey(config: Record<string, unknown>): boolean {
  const mcp = config.mcp;
  if (!isPlainObject(mcp)) return false;
  const servers = mcp.servers;
  return isPlainObject(servers) && typeof servers.type !== "string";
}

/**
 * Returns a view of the config where `mcp` holds the server map for either
 * layout, so the shared `configKey: "mcp"` helpers find the Context7 entry.
 */
export function openCodeServerConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (!usesOpenCodeServersKey(config)) return config;
  return { ...config, mcp: (config.mcp as Record<string, unknown>).servers };
}

/** OpenCode v2 uses `disabled` instead of v1's `enabled` flag. */
function toOpenCodeV2Entry(entry: Record<string, unknown>): Record<string, unknown> {
  const { enabled, ...rest } = entry;
  return enabled === false ? { ...rest, disabled: true } : rest;
}

/**
 * Sets the `context7` server to `entry`, or removes it when `entry` is omitted.
 * Uses `mcp.servers.context7` for OpenCode v2 configs and `mcp.context7`
 * otherwise. Edits the file text in place, so comments and trailing commas
 * outside the entry survive.
 */
export async function editOpenCodeServer(
  filePath: string,
  entry?: Record<string, unknown>
): Promise<void> {
  const config = await readJsonConfig(filePath);
  const v2 = usesOpenCodeServersKey(config);
  const sectionPath = v2 ? ["mcp", "servers"] : ["mcp"];
  const servers = Object.keys((openCodeServerConfig(config).mcp ?? {}) as object);
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  const source = raw.trim() ? raw : "{}\n";
  // modify() leaves `{ , }` when it deletes the only property of an object that
  // has a trailing comma, so empty the server map instead.
  const edits =
    !entry && servers.join() === "context7"
      ? modify(source, sectionPath, {}, options)
      : modify(
          source,
          [...sectionPath, "context7"],
          entry && v2 ? toOpenCodeV2Entry(entry) : entry,
          options
        );
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, applyEdits(source, edits), "utf-8");
}
