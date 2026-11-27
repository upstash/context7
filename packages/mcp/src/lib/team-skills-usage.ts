import { createHash } from "node:crypto";
import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { credentialOwner } from "./credential-owner.js";
import { hasMcpAssertionKey } from "./encryption.js";
import { mcpAssertionHeader, SNAPSHOT_REQUEST_TIMEOUT_MS } from "./snapshot-poller.js";

/**
 * How agents use team skills (skills.ts), for context7app's /admin/skills-over-mcp: per teamspace,
 * skill and call, the count and the callers of the last minute. Counted in memory and posted once
 * a minute, so serving a skill never waits for the Context7 API. A failed post drops its minute.
 * Clients may cache skills/list, skills/get and files for the cache hint's lifetime, so these are
 * the calls that reached this server, not every time an agent used a skill.
 */

export const TEAM_SKILLS_USAGE_PATH = "/internal/mcp/team-skills-usage";
/** Keep in step with the app route: the plaintext of its assertion. */
const USAGE_ASSERTION_SUBJECT = "team-skills-usage";
const FLUSH_MS = 60_000;
/** Bounds per minute; what does not fit is counted in `dropped`. */
const MAX_ENTRIES = 5_000;
const MAX_CALLERS_PER_ENTRY = 500;

/** `list`: skills/list with team skills in it; `get`: a team skill's entry; `read`: one of its files. */
export type TeamSkillUse = "list" | "get" | "read";

interface Entry {
  teamspace: string;
  /** Absent for `list`, which lists every skill of the teamspace. */
  skill?: string;
  kind: TeamSkillUse;
  count: number;
  callers: Set<string>;
}

/** The body the app route reads (`teamSkillsUsageSchema` in context7app). */
export interface TeamSkillsUsageBody {
  entries: {
    teamspace: string;
    skill?: string;
    kind: TeamSkillUse;
    count: number;
    callers: string[];
  }[];
  dropped: number;
}

let entries = new Map<string, Entry>();
let dropped = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let failuresLogged = 0;

/**
 * A caller's pseudonymous ID for unique counts: a hash of the API key hash or the user ID the
 * snapshot knows them by, never the credential.
 */
export function usageCallerOf(credential: string | undefined): string | undefined {
  const owner = credential ? credentialOwner(credential) : undefined;
  if (!owner) return undefined;
  const id = "apiKeyHash" in owner ? `k:${owner.apiKeyHash}` : `u:${owner.userId}`;
  return createHash("sha256").update(`team-skills-usage:${id}`).digest("hex").slice(0, 32);
}

/** Counts one call. Never throws and never waits. */
export function recordTeamSkillUse(
  teamspace: string,
  kind: TeamSkillUse,
  skill: string | undefined,
  caller: string | undefined
): void {
  if (!hasMcpAssertionKey()) return;
  const key = `${teamspace}\n${kind}\n${skill ?? ""}`;
  let entry = entries.get(key);
  if (!entry) {
    if (entries.size >= MAX_ENTRIES) {
      dropped++;
      return;
    }
    entry = { teamspace, kind, count: 0, callers: new Set(), ...(skill && { skill }) };
    entries.set(key, entry);
  }
  entry.count++;
  if (caller && entry.callers.size < MAX_CALLERS_PER_ENTRY) entry.callers.add(caller);
  timer ??= setInterval(() => void flushTeamSkillsUsage(), FLUSH_MS).unref();
}

/** Posts the counts so far and starts a new minute. Never throws. */
export async function flushTeamSkillsUsage(): Promise<void> {
  if (entries.size === 0 && dropped === 0) return;
  const body: TeamSkillsUsageBody = {
    entries: [...entries.values()].map(({ callers, ...entry }) => ({
      ...entry,
      callers: [...callers],
    })),
    dropped,
  };
  entries = new Map();
  dropped = 0;
  try {
    const response = await fetch(`${CONTEXT7_API_BASE_URL}${TEAM_SKILLS_USAGE_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...mcpAssertionHeader(USAGE_ASSERTION_SUBJECT),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SNAPSHOT_REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`the Context7 API answered HTTP ${response.status}`);
    failuresLogged = 0;
  } catch (error) {
    // Logged once per run of failures, so an app outage does not flood the log every minute.
    if (failuresLogged++ === 0) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[Context7] Could not report team skill usage (${reason})`);
    }
  }
}

/** Test hook: forget the counts and stop the timer. */
export function resetTeamSkillsUsage(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  entries = new Map();
  dropped = 0;
  failuresLogged = 0;
}
