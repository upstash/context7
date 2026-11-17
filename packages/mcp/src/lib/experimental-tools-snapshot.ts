import { createHash } from "node:crypto";
import * as jose from "jose";
import {
  EXPERIMENTAL_TOOL_NAMES,
  experimentalToolsFrom,
  type ExperimentalTool,
} from "./tool-names.js";

/**
 * The hosted server's copy of every user's experimental tools choice, read from the app's
 * experimental tools Redis database and kept in process memory, the way feature flag SDKs
 * evaluate flags locally (LaunchDarkly, Unleash). A request reads only this copy: listing tools
 * never calls the Context7 API, Supabase or Redis, so traffic cannot turn into lookups (the
 * CTX7-3866 incident). Each process asks Redis for one version number every POLL_MS and reads the
 * whole copy only after a change, so the Redis load is a few commands a minute per process
 * whatever the traffic.
 *
 * The app keeps the database (context7app `lib/mcp/experimentalToolsStore.ts`); keep the two in
 * step. One hash holds only users with a tool on:
 * - `u:<userId>`: the choice, `{ "all": boolean, "tools": string[] }`;
 * - `k:<sha256 hex of an API key>`: the user id of that key's member;
 * and a counter the app increments on every change.
 */
export const SNAPSHOT_ENTRIES_KEY = "#mcp_experimental_tools#entries";
export const SNAPSHOT_VERSION_KEY = "#mcp_experimental_tools#version";

const POLL_MS = 15_000;
/** Poll interval while no snapshot was ever read, so a process that started during a blip recovers fast. */
const FIRST_READ_RETRY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
/** At most this many failures in a row are logged; the next success says it recovered. */
const LOGGED_FAILURES = 3;

interface Snapshot {
  version: string;
  users: Map<string, ExperimentalTool[]>;
  apiKeys: Map<string, string>;
}

interface SnapshotSource {
  url: string;
  token: string;
}

let source: SnapshotSource | undefined;
let snapshot: Snapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let failuresInRow = 0;

/** Read from `MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL` / `_TOKEN` (a read-only token is enough). */
export function snapshotSourceFromEnv(env = process.env): SnapshotSource | undefined {
  const url = env.MCP_EXPERIMENTAL_TOOLS_REDIS_REST_URL?.trim();
  const token = env.MCP_EXPERIMENTAL_TOOLS_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

/** Whether this process takes experimental tools from the snapshot. */
export function isSnapshotEnabled(): boolean {
  return source !== undefined;
}

/** Whether the first read of the snapshot has finished. */
export function isSnapshotLoaded(): boolean {
  return snapshot !== undefined;
}

async function redis<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${source!.url}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${source!.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Redis answered HTTP ${response.status}`);
  return (await response.json()) as T;
}

type RedisReply = { result?: unknown; error?: string };

function parseSnapshot(version: string, flat: unknown): Snapshot {
  const users = new Map<string, ExperimentalTool[]>();
  const apiKeys = new Map<string, string>();
  const fields = Array.isArray(flat) ? flat : [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const field = fields[i];
    const value = fields[i + 1];
    if (typeof field !== "string" || typeof value !== "string") continue;
    if (field.startsWith("k:")) {
      apiKeys.set(field.slice(2), value);
    } else if (field.startsWith("u:")) {
      try {
        const choice = JSON.parse(value) as { all?: unknown; tools?: unknown };
        const tools =
          choice.all === true ? [...EXPERIMENTAL_TOOL_NAMES] : experimentalToolsFrom(choice.tools);
        if (tools.length > 0) users.set(field.slice(2), tools);
      } catch {
        // A malformed entry lists nothing for that user; the rest of the snapshot still loads.
      }
    }
  }
  return { version, users, apiKeys };
}

/** One poll: read the version, and the whole snapshot only when it changed. */
export async function refreshSnapshot(): Promise<void> {
  if (!source) return;
  try {
    const current = await redis<RedisReply>("", ["GET", SNAPSHOT_VERSION_KEY]);
    if (current.error) throw new Error(current.error);
    const version = String(current.result ?? "0");
    if (snapshot?.version !== version) {
      // Every app write is one script that also increments the version, so entries read between
      // two equal versions are one consistent state. A pipeline, not a transaction: it needs no
      // MULTI support and never holds other clients back.
      const [before, entries, after] = await redis<RedisReply[]>("/pipeline", [
        ["GET", SNAPSHOT_VERSION_KEY],
        ["HGETALL", SNAPSHOT_ENTRIES_KEY],
        ["GET", SNAPSHOT_VERSION_KEY],
      ]);
      const error = before?.error ?? entries?.error ?? after?.error;
      if (error) throw new Error(error);
      const readVersion = String(before?.result ?? "0");
      // A change landed during the read: keep the last snapshot and read again next poll.
      if (readVersion !== String(after?.result ?? "0")) return;
      snapshot = parseSnapshot(readVersion, entries?.result);
    }
    if (failuresInRow > 0) {
      console.error(
        `[Context7] Experimental tools snapshot read again after ${failuresInRow} failures`
      );
    }
    failuresInRow = 0;
  } catch (error) {
    // Keep serving the last snapshot: an outage of the database never changes a tool list.
    failuresInRow++;
    if (failuresInRow <= LOGGED_FAILURES) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[Context7] Could not read the experimental tools snapshot (${reason}); keeping the ${
          snapshot ? `version ${snapshot.version}` : "empty list"
        }`
      );
    }
  }
}

/**
 * Start polling when the database is configured. The first read is awaited (bounded by the
 * request timeout) so a new process lists the right tools from its first request.
 */
export async function startExperimentalToolsSnapshot(
  configured = snapshotSourceFromEnv()
): Promise<void> {
  stopExperimentalToolsSnapshot();
  source = configured;
  if (!source) return;
  await refreshSnapshot();
  const schedule = () => {
    // Jitter keeps the processes of one deployment from polling in step.
    timer = setTimeout(
      async () => {
        await refreshSnapshot();
        schedule();
      },
      (snapshot ? POLL_MS : FIRST_READ_RETRY_MS) + Math.floor(Math.random() * 2_000)
    );
    timer.unref?.();
  };
  schedule();
}

export function stopExperimentalToolsSnapshot(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  source = undefined;
  snapshot = undefined;
  failuresInRow = 0;
}

/** How a credential names its user, without a network call; undefined when it cannot. */
export type SnapshotIdentity = { apiKey: string } | { userId: string };

/** The sha256 hex the app stores for an API key (`hashApiKey`). */
export function apiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** The `sub` of a JWT already verified at the authentication boundary. */
export function verifiedJwtSubject(token: string): string | undefined {
  try {
    const { sub } = jose.decodeJwt(token);
    return typeof sub === "string" && sub ? sub : undefined;
  } catch {
    return undefined;
  }
}

/** The caller's experimental tools from the snapshot: nothing on before it is first read. */
export function snapshotExperimentalTools(identity: SnapshotIdentity): ExperimentalTool[] {
  if (!snapshot) return [];
  const userId =
    "userId" in identity ? identity.userId : snapshot.apiKeys.get(apiKeyHash(identity.apiKey));
  return (userId && snapshot.users.get(userId)) || [];
}
