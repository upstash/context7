import * as jose from "jose";
import type {
  Skill,
  SkillFrontmatter,
  SkillResourceEntry,
} from "@modelcontextprotocol/server/ext/skills";
import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { apiKeyHash } from "./experimental-tools-snapshot.js";
import { isClerkOAuthJwt, isJWT } from "./jwt.js";
import { checkOAuthAudience } from "./oauth-audience.js";
import { isOpaqueOAuthToken, validatedOpaqueOAuthTokenUserId } from "./oauth-token-validation.js";
import {
  createSnapshotPoller,
  mcpAssertionHeader,
  SNAPSHOT_REQUEST_TIMEOUT_MS,
} from "./snapshot-poller.js";

/**
 * The hosted server's copy of every teamspace's Agent Skills (snapshot-poller.ts), polled from
 * context7app `app/api/internal/mcp/team-skills-snapshot`: listing skills never calls the
 * Context7 API, only reading a team skill's file does (skills.ts caches those by digest).
 */
export const TEAM_SKILLS_SNAPSHOT_PATH = "/internal/mcp/team-skills-snapshot";
export const TEAM_SKILLS_FILE_PATH = "/internal/mcp/team-skills-file";
/** Keep in step with the routes: the plaintexts of their assertions. */
const SNAPSHOT_ASSERTION_SUBJECT = "team-skills-snapshot";
const FILE_ASSERTION_SUBJECT = "team-skills-file";

/** At most this many dropped entries are logged per snapshot read. */
const LOGGED_DROPS = 10;

/** Served by skills.ts for everyone, so a teamspace cannot publish a skill under these names. */
const RESERVED_SKILL_NAMES: ReadonlySet<string> = new Set(["context7-mcp"]);
const SKILL_NAME = /^[\da-z]+(?:-[\da-z]+)*$/;
const DIGEST = /^sha256:[\da-f]{64}$/;

/** One teamspace's skills, with canonical URIs, indexed for skills.ts. */
export interface TeamSkills {
  teamspaceId: string;
  /** Sorted by URI. */
  skills: readonly Skill[];
  /** By `SKILL.md` URI. */
  entries: ReadonlyMap<string, Skill>;
  /** Every file of every skill, by URI. */
  files: ReadonlyMap<string, SkillResourceEntry>;
}

interface Snapshot {
  version: string;
  teams: Map<string, TeamSkills>;
  apiKeys: Map<string, string>;
  users: Map<string, string>;
}

/** The snapshot route's body (`TeamSkillsSnapshot` in context7app). */
interface SnapshotBody {
  version?: unknown;
  teams?: Record<string, unknown>;
  apiKeys?: Record<string, unknown>;
  users?: Record<string, unknown>;
}

/**
 * How long the credential maps stay trusted without a successful poll. After that no credential
 * resolves to a teamspace (only context7-mcp is served) until polling recovers, so an API key
 * revoked or a member removed during an outage of the app loses its team's skills within this time.
 */
export const STALE_AFTER_MS = 15 * 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const characters = (text: string) => [...text].length;

/** `uri` in WHATWG form when it is a `skill://` URI without query or fragment. */
function canonicalSkillUri(uri: unknown): string | undefined {
  if (typeof uri !== "string") return undefined;
  try {
    const url = new URL(uri);
    return url.protocol === "skill:" && !url.search && !url.hash ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** True when `uri` names a file strictly inside `root`, with no empty, `.`, `..` or `/` segment. */
function isInside(root: string, uri: string): boolean {
  if (!uri.startsWith(`${root}/`)) return false;
  return uri
    .slice(root.length + 1)
    .split("/")
    .every((segment) => {
      const name = safeDecode(segment);
      return name !== "" && name !== "." && name !== ".." && !/[/\0]/.test(name);
    });
}

/**
 * The entry with canonical URIs, or why it cannot be served. These are the rules the skills
 * extension checks under `strict` (SEP-2640 and Agent Skills), so an entry the app got wrong is
 * dropped here instead of failing the caller's whole skills/list.
 */
function parseSkill(value: unknown): Skill | string {
  if (!isRecord(value) || !isRecord(value.frontmatter)) return "not a skill entry";
  const { name, description, compatibility, metadata } = value.frontmatter;
  if (typeof name !== "string" || name.length > 64 || !SKILL_NAME.test(name)) {
    return "frontmatter name must be 1-64 lowercase letters, digits and single hyphens";
  }
  if (RESERVED_SKILL_NAMES.has(name)) return `the name ${name} is reserved`;
  if (typeof description !== "string" || description === "" || characters(description) > 1024) {
    return "frontmatter description must be 1-1024 characters";
  }
  if (
    compatibility !== undefined &&
    (typeof compatibility !== "string" || compatibility === "" || characters(compatibility) > 500)
  ) {
    return "frontmatter compatibility must be a string of 1-500 characters";
  }
  if (
    metadata !== undefined &&
    !(isRecord(metadata) && Object.values(metadata).every((item) => typeof item === "string"))
  ) {
    return "frontmatter metadata must map strings to strings";
  }
  const root = `skill://${name}`;
  const manifest = `${root}/SKILL.md`;
  if (canonicalSkillUri(value.uri) !== manifest) return `uri must be ${manifest}`;
  if (!Array.isArray(value.resources)) return "resources must be a list of files";

  const resources: SkillResourceEntry[] = [];
  const seen = new Set<string>();
  for (const resource of value.resources as unknown[]) {
    const uri = isRecord(resource) ? canonicalSkillUri(resource.uri) : undefined;
    if (!isRecord(resource) || uri === undefined || !isInside(root, uri)) {
      return `every resource must be a file inside ${root}`;
    }
    const { digest, size } = resource;
    if (typeof digest !== "string" || !DIGEST.test(digest)) {
      return `${uri}: digest must be "sha256:" and 64 lowercase hex characters`;
    }
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      return `${uri}: size must be a byte count`;
    }
    if (seen.has(uri)) return `${uri} is listed more than once`;
    seen.add(uri);
    resources.push({ uri, digest, size });
  }
  if (!seen.has(manifest)) return `resources must include ${manifest}`;
  resources.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  return { uri: manifest, frontmatter: value.frontmatter as SkillFrontmatter, resources };
}

function parseTeam(teamspaceId: string, value: unknown, drop: (reason: string) => void) {
  const entries = new Map<string, Skill>();
  for (const item of Array.isArray(value) ? (value as unknown[]) : []) {
    const skill = parseSkill(item);
    if (typeof skill === "string") {
      const uri = isRecord(item) && typeof item.uri === "string" ? item.uri : "an entry";
      drop(`${uri} of teamspace ${teamspaceId}: ${skill}`);
    } else if (entries.has(skill.uri)) {
      drop(`${skill.uri} of teamspace ${teamspaceId}: listed more than once`);
    } else {
      entries.set(skill.uri, skill);
    }
  }
  if (entries.size === 0) return undefined;
  const skills = [...entries.values()].sort((a, b) => (a.uri < b.uri ? -1 : 1));
  const files = new Map<string, SkillResourceEntry>();
  for (const skill of skills) {
    if (skill.resources === "dynamic") continue;
    for (const file of skill.resources) files.set(file.uri, file);
  }
  return { teamspaceId, skills, entries, files } satisfies TeamSkills;
}

function stringMap(record: Record<string, unknown> | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "string") map.set(key, value);
  }
  return map;
}

function parseSnapshot(value: unknown): Snapshot {
  const body = (isRecord(value) ? value : {}) as SnapshotBody;
  let dropped = 0;
  const drop = (reason: string) => {
    if (++dropped <= LOGGED_DROPS) console.error(`[Context7] Team skill dropped: ${reason}`);
  };
  const teams = new Map<string, TeamSkills>();
  for (const [teamspaceId, skills] of Object.entries(body.teams ?? {})) {
    const team = parseTeam(teamspaceId, skills, drop);
    if (team) teams.set(teamspaceId, team);
  }
  if (dropped > LOGGED_DROPS) {
    console.error(`[Context7] ${dropped - LOGGED_DROPS} more team skills dropped`);
  }
  return {
    version: String(body.version ?? "0"),
    teams,
    apiKeys: stringMap(body.apiKeys),
    users: stringMap(body.users),
  };
}

const poller = createSnapshotPoller({
  label: "team skills",
  path: TEAM_SKILLS_SNAPSHOT_PATH,
  subject: SNAPSHOT_ASSERTION_SUBJECT,
  parse: parseSnapshot,
});

/** Whether this process serves team skills from the snapshot. */
export const isTeamSkillsSnapshotEnabled = () => poller.enabled;
export const refreshTeamSkillsSnapshot = poller.refresh;
export const startTeamSkillsSnapshot = poller.start;
export const stopTeamSkillsSnapshot = poller.stop;

/**
 * The teamspace a credential belongs to, found without a network call: a Clerk OAuth JWT's `sub`
 * (the request got here only after `evaluateMcpAuthentication` verified it) or an opaque token's
 * user from its cached auth check, through the snapshot's members; an API key through the
 * snapshot's keys. Other JWTs (Entra, Vercel Marketplace) name no teamspace here. None while the
 * snapshot is older than STALE_AFTER_MS.
 */
export function teamspaceOf(credential: string | undefined): string | undefined {
  const snapshot = poller.current;
  if (!snapshot || !credential) return undefined;
  if (Date.now() - poller.lastReadAt > STALE_AFTER_MS) return undefined;
  const member = (userId: string | undefined) =>
    userId === undefined ? undefined : snapshot.users.get(userId);
  if (isOpaqueOAuthToken(credential)) return member(validatedOpaqueOAuthTokenUserId(credential));
  if (isClerkOAuthJwt(credential)) {
    const { sub, aud } = jose.decodeJwt(credential);
    // Team skills can be private, so a token issued for another resource gets none, whatever
    // MCP_OAUTH_AUDIENCE_ENFORCEMENT lets through for the public tools. A token with no `aud`
    // (grants from before Clerk filled it) still counts, as in the app's `foreign` mode. Opaque
    // tokens are judged by the app's auth check, which applies the app's enforcement mode.
    const audience = checkOAuthAudience(aud);
    if (!audience.allowed && audience.aud !== "missing") return undefined;
    return member(typeof sub === "string" ? sub : undefined);
  }
  if (isJWT(credential)) return undefined;
  return snapshot.apiKeys.get(apiKeyHash(credential));
}

/** The teamspace's skills from the snapshot; `undefined` when it has none. */
export function teamSkillsFor(teamspaceId: string | undefined): TeamSkills | undefined {
  return teamspaceId === undefined ? undefined : poller.current?.teams.get(teamspaceId);
}

/**
 * A team skill file's bytes from the app, unchecked: skills.ts verifies them against the entry.
 * Refuses a response longer than `maxBytes`, whether it announces its length or not: the body is
 * read in chunks and dropped as soon as it runs past the limit.
 */
export async function fetchTeamSkillFile(
  teamspaceId: string,
  digest: string,
  maxBytes: number
): Promise<Uint8Array> {
  const url = new URL(`${CONTEXT7_API_BASE_URL}${TEAM_SKILLS_FILE_PATH}`);
  url.searchParams.set("teamspace", teamspaceId);
  url.searchParams.set("digest", digest);
  const response = await fetch(url, {
    headers: mcpAssertionHeader(FILE_ASSERTION_SUBJECT),
    signal: AbortSignal.timeout(SNAPSHOT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`the Context7 API answered HTTP ${response.status}`);
  }
  const tooLarge = () => new Error(`the file is larger than its entry's ${maxBytes} bytes`);
  if (Number(response.headers.get("Content-Length") ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
