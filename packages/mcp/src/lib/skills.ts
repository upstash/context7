import { createHash } from "node:crypto";
import { ProtocolError, ProtocolErrorCode, type McpServer } from "@modelcontextprotocol/server";
import {
  DIRECTORY_MIME_TYPE,
  skillEntry,
  type DirectoryResource,
  type Skill,
  type SkillReadResult,
  type SkillResourceEntry,
  type SkillSource,
  SkillsExtension,
} from "@modelcontextprotocol/server/ext/skills";
import { CONTEXT7_MCP_SKILL } from "./skill-md.js";
import { canonicalSkillUri, safeDecode } from "./skill-uri.js";
import { fetchTeamSkillFile, teamSkillsFor } from "./team-skills-snapshot.js";
import { recordTeamSkillCall } from "./telemetry-runtime.js";

/**
 * The skills one caller sees through the MCP skills extension (SEP-2640): the repo's
 * skill://context7-mcp/SKILL.md for everyone, then the skills of the caller's teamspace from the
 * snapshot (team-skills-snapshot.ts). A server takes one skills extension, so both are one source.
 */

const CONTEXT7_MCP = await skillEntry("context7-mcp", { "SKILL.md": CONTEXT7_MCP_SKILL });
const CONTEXT7_MCP_FILE = (CONTEXT7_MCP.resources as SkillResourceEntry[])[0];
/** resources/list is cached publicly for an hour, so it names only the skill everyone gets. */
const LISTED_RESOURCES = [
  {
    uri: CONTEXT7_MCP.uri,
    name: CONTEXT7_MCP.frontmatter.name,
    description: CONTEXT7_MCP.frontmatter.description,
    mimeType: "text/markdown",
    size: CONTEXT7_MCP_FILE.size,
  },
];

/** Verified team skill files by digest, so a file is fetched once per process while it is read. */
const FILE_CACHE_BYTES = 32 * 1024 * 1024;
const fileCache = new Map<string, Uint8Array>();
let cachedBytes = 0;
const inFlight = new Map<string, Promise<Uint8Array>>();

function cached(digest: string): Uint8Array | undefined {
  const bytes = fileCache.get(digest);
  if (bytes) {
    // Map order is the eviction order: a hit moves the file to the end.
    fileCache.delete(digest);
    fileCache.set(digest, bytes);
  }
  return bytes;
}

function remember(digest: string, bytes: Uint8Array): void {
  if (bytes.byteLength > FILE_CACHE_BYTES || fileCache.has(digest)) return;
  fileCache.set(digest, bytes);
  cachedBytes += bytes.byteLength;
  for (const [oldest, old] of fileCache) {
    if (cachedBytes <= FILE_CACHE_BYTES) break;
    fileCache.delete(oldest);
    cachedBytes -= old.byteLength;
  }
}

/** Test hook: forget every cached team skill file. */
export function resetTeamSkillFileCache(): void {
  fileCache.clear();
  inFlight.clear();
  cachedBytes = 0;
}

function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function download(teamspaceId: string, uri: string, file: SkillResourceEntry) {
  let bytes: Uint8Array;
  try {
    bytes = await fetchTeamSkillFile(teamspaceId, file.digest, file.size);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[Context7] Could not read team skill file ${uri} (${reason})`);
    throw new ProtocolError(ProtocolErrorCode.InternalError, `${uri} could not be read`);
  }
  // Content addressed: bytes that do not match the digest are never served or cached. The size
  // is checked in teamFile, for downloads and cache hits alike.
  if (sha256Digest(bytes) !== file.digest) {
    console.error(`[Context7] Team skill file ${uri} does not match its entry; refused`);
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      `${uri} does not match its skill entry`
    );
  }
  remember(file.digest, bytes);
  return bytes;
}

/**
 * The verified bytes of a team skill file. Equal digests are equal bytes, whichever team asks, but
 * the size is checked against this caller's entry too, so a cache hit or a download another entry
 * started is held to the same check as a cold read.
 */
async function teamFile(teamspaceId: string, uri: string, file: SkillResourceEntry) {
  let bytes = cached(file.digest);
  if (!bytes) {
    const key = `${teamspaceId}\n${file.digest}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = download(teamspaceId, uri, file).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    bytes = await pending;
  }
  if (bytes.byteLength !== file.size) {
    console.error(`[Context7] Team skill file ${uri} does not match its entry's size; refused`);
    throw new ProtocolError(
      ProtocolErrorCode.InternalError,
      `${uri} does not match its skill entry`
    );
  }
  return bytes;
}

/** The SDK catalog's MIME types by extension (it does not export `mimeTypeFor`). */
const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  py: "text/x-python",
  sh: "application/x-sh",
  bash: "application/x-sh",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  html: "text/html",
  css: "text/css",
  csv: "text/csv",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function mimeTypeFor(uri: string): string {
  const name = uri.slice(uri.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return Object.hasOwn(MIME_TYPES, extension) ? MIME_TYPES[extension] : "application/octet-stream";
}

/** Text when the bytes are UTF-8 (a BOM is kept), else bytes, as the SDK catalog sends files. */
function readResult(uri: string, bytes: Uint8Array): SkillReadResult {
  const mimeType = mimeTypeFor(uri);
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
      mimeType,
    };
  } catch {
    return { bytes, mimeType };
  }
}

/** The direct children of a skill directory, from the entry's file list. */
function directoryChildren(skills: readonly Skill[], dir: string): DirectoryResource[] | undefined {
  const skill = skills.find((entry) => {
    const root = entry.uri.slice(0, -"/SKILL.md".length);
    return dir === root || dir.startsWith(`${root}/`);
  });
  if (!skill || skill.resources === "dynamic") return undefined;
  const prefix = `${dir}/`;
  const children = new Map<string, DirectoryResource>();
  for (const file of skill.resources) {
    if (!file.uri.startsWith(prefix)) continue;
    const rest = file.uri.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      children.set(file.uri, {
        uri: file.uri,
        name: safeDecode(rest),
        mimeType: mimeTypeFor(file.uri),
        size: file.size,
      });
    } else {
      const uri = `${prefix}${rest.slice(0, slash)}`;
      children.set(uri, {
        uri,
        name: safeDecode(rest.slice(0, slash)),
        mimeType: DIRECTORY_MIME_TYPE,
      });
    }
  }
  if (children.size === 0) return undefined;
  return [...children.values()].sort((a, b) => (a.uri < b.uri ? -1 : 1));
}

/**
 * The skills source for one caller. `teamspaceId` is the caller's teamspace (`teamspaceOf`); the
 * snapshot is read on every call, so a request sees the skills of that moment. Team skill calls
 * are counted in the `context7.mcp.team_skills.calls` metric.
 */
export function skillSource(teamspaceId: string | undefined): SkillSource {
  const team = () => teamSkillsFor(teamspaceId);
  const skills = () => [CONTEXT7_MCP, ...(team()?.skills ?? [])];
  return {
    async list() {
      const current = team();
      if (current?.skills.length) recordTeamSkillCall("list");
      return { skills: [CONTEXT7_MCP, ...(current?.skills ?? [])] };
    },
    async get(uri) {
      const key = canonicalSkillUri(uri);
      // The SDK checks the entry against the URI as sent, so only its exact canonical form matches.
      if (key === undefined || key !== uri) return undefined;
      if (key === CONTEXT7_MCP.uri) return CONTEXT7_MCP;
      const current = team();
      const entry = current?.entries.get(key);
      if (entry) recordTeamSkillCall("get");
      return entry;
    },
    async read(uri) {
      const key = canonicalSkillUri(uri, { dropFragment: true });
      if (key === undefined) return undefined;
      if (key === CONTEXT7_MCP.uri) return { text: CONTEXT7_MCP_SKILL, mimeType: "text/markdown" };
      const current = team();
      const file = current?.files.get(key);
      if (!current || !file) return undefined;
      const result = readResult(key, await teamFile(current.teamspaceId, key, file));
      recordTeamSkillCall("read");
      return result;
    },
    async readDirectory(uri) {
      const key = canonicalSkillUri(uri, { dropFragment: true })?.replace(/\/+$/, "");
      const resources = key === undefined ? undefined : directoryChildren(skills(), key);
      return resources && { resources };
    },
    async listResources() {
      return LISTED_RESOURCES;
    },
  };
}

/**
 * Serves the skills extension on one per-request server: the caller's skills (`skillSource`)
 * with `cacheHint` on skills/list, skills/get, directory reads and files.
 */
export function attachSkills(
  server: McpServer,
  teamspaceId: string | undefined,
  cacheHint: { ttlMs: number; cacheScope: "public" | "private" }
): void {
  // attach() is an @experimental SDK API: how an extension is wired to a server may change in a
  // minor SDK release, so recheck this call on every SDK upgrade.
  new SkillsExtension({
    source: skillSource(teamspaceId),
    cacheHint,
    // Not strict: the SDK drops an invalid team entry instead of failing the team's skills/list.
    onWarning: ({ path, message }) => console.error(`[Context7] Skill ${path}: ${message}`),
  }).attach(server);
}
