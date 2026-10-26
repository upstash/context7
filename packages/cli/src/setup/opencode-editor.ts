import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import { applyEdits, modify } from "jsonc-parser";
import { readJsonConfig } from "./mcp-writer.js";

const options = { formattingOptions: { tabSize: 2, insertSpaces: true } };

/**
 * Sets `mcp.context7` to `entry`, or removes it when `entry` is omitted. Edits the
 * file text in place, so comments and trailing commas outside the entry survive.
 */
export async function editOpenCodeServer(
  filePath: string,
  entry?: Record<string, unknown>
): Promise<void> {
  const servers = Object.keys(((await readJsonConfig(filePath)).mcp ?? {}) as object);
  const raw = await readFile(filePath, "utf-8").catch(() => "");
  const source = raw.trim() ? raw : "{}\n";
  // modify() leaves `{ , }` when it deletes the only property of an object that
  // has a trailing comma, so empty the `mcp` object instead.
  const edits =
    !entry && servers.join() === "context7"
      ? modify(source, ["mcp"], {}, options)
      : modify(source, ["mcp", "context7"], entry, options);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, applyEdits(source, edits), "utf-8");
}
