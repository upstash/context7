import { createHash } from "node:crypto";
import * as jose from "jose";
import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { hasMcpAssertionKey, sealMcpAssertion } from "./encryption.js";
import { isClerkOAuthJwt, isJWT } from "./jwt.js";
import { isOpaqueOAuthToken, validatedOpaqueOAuthTokenUserId } from "./oauth-token-validation.js";
import { experimentalToolsFromChoice, type ExperimentalTool } from "./tool-names.js";

/**
 * The hosted server's copy of every user's experimental tools choice, kept in process memory the
 * way feature flag SDKs evaluate flags locally (LaunchDarkly, Unleash). A request reads only this
 * copy: listing tools never calls the Context7 API, so traffic cannot turn into lookups (the
 * CTX7-3866 incident). Each process polls the app's snapshot endpoint every POLL_MS with
 * `If-None-Match`; without a change the app answers 304 after one Redis read, so the load is a
 * few small requests a minute per process whatever the traffic.
 *
 * The endpoint (context7app `app/api/internal/mcp/experimental-tools-snapshot/route.ts`) is for
 * the hosted server only: it is authenticated with an assertion sealed with the key the app shares
 * with it (`MCP_CLIENT_IP_ASSERTION_KEY`), so a process without that key does not poll.
 */
export const SNAPSHOT_PATH = "/internal/mcp/experimental-tools-snapshot";
/** Keep in step with the route: the tag and plaintext of its assertion. */
const SNAPSHOT_ASSERTION_TAG = "s1";
const SNAPSHOT_ASSERTION_SUBJECT = "experimental-tools-snapshot";

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

/** The endpoint's body (`ExperimentalToolsSnapshot` in context7app). */
interface SnapshotBody {
  version?: unknown;
  users?: Record<string, unknown>;
  apiKeys?: Record<string, unknown>;
}

let enabled = false;
let snapshot: Snapshot | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let failuresInRow = 0;

/** Whether this process takes experimental tools from the snapshot. */
export function isSnapshotEnabled(): boolean {
  return enabled;
}

function parseSnapshot(body: SnapshotBody): Snapshot {
  const users = new Map<string, ExperimentalTool[]>();
  for (const [userId, choice] of Object.entries(body.users ?? {})) {
    const tools = experimentalToolsFromChoice(choice);
    if (tools.length > 0) users.set(userId, tools);
  }
  const apiKeys = new Map<string, string>();
  for (const [hash, userId] of Object.entries(body.apiKeys ?? {})) {
    if (typeof userId === "string") apiKeys.set(hash, userId);
  }
  return { version: String(body.version ?? "0"), users, apiKeys };
}

/** One poll: a 304 keeps the copy, a 200 replaces it. */
export async function refreshSnapshot(): Promise<void> {
  if (!enabled) return;
  try {
    const assertion = sealMcpAssertion(SNAPSHOT_ASSERTION_TAG, SNAPSHOT_ASSERTION_SUBJECT);
    if (!assertion) throw new Error("the MCP assertion could not be sealed");
    const response = await fetch(`${CONTEXT7_API_BASE_URL}${SNAPSHOT_PATH}`, {
      headers: {
        "X-Context7-Mcp-Assertion": assertion,
        ...(snapshot && { "If-None-Match": `"${snapshot.version}"` }),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 304) {
      if (!response.ok) throw new Error(`the Context7 API answered HTTP ${response.status}`);
      snapshot = parseSnapshot((await response.json()) as SnapshotBody);
    }
    if (failuresInRow > 0) {
      console.error(
        `[Context7] Experimental tools snapshot read again after ${failuresInRow} failures`
      );
    }
    failuresInRow = 0;
  } catch (error) {
    // Keep serving the last snapshot: an outage of the app never changes a tool list.
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
 * Start polling when this process holds the shared MCP assertion key (the hosted server). The
 * first read is awaited, up to REQUEST_TIMEOUT_MS, so a new process lists the right tools from
 * its first request.
 */
export async function startExperimentalToolsSnapshot(
  canAuthenticate = hasMcpAssertionKey()
): Promise<void> {
  stopExperimentalToolsSnapshot();
  enabled = canAuthenticate;
  if (!enabled) return;
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
  enabled = false;
  snapshot = undefined;
  failuresInRow = 0;
}

/** The sha256 hex the app stores for an API key (`hashApiKey`). */
export function apiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * The user a credential names, found without a network call: a Clerk OAuth JWT's `sub` (the
 * request got here only after `evaluateMcpAuthentication` verified it), an opaque token's user
 * from its cached auth check, or an API key's user from the snapshot. Other JWTs (Entra, Vercel
 * Marketplace) name no Context7 user here.
 */
function userIdOf(credential: string, apiKeys: Map<string, string>): string | undefined {
  if (isOpaqueOAuthToken(credential)) return validatedOpaqueOAuthTokenUserId(credential);
  if (isClerkOAuthJwt(credential)) {
    const { sub } = jose.decodeJwt(credential);
    return typeof sub === "string" ? sub : undefined;
  }
  if (isJWT(credential)) return undefined;
  return apiKeys.get(apiKeyHash(credential));
}

/**
 * The caller's experimental tools from the snapshot, with no network call. Nothing is on for an
 * anonymous caller, an unknown credential, or before the first read.
 */
export function snapshotExperimentalTools(credential: string | undefined): ExperimentalTool[] {
  if (!snapshot || !credential) return [];
  const userId = userIdOf(credential, snapshot.apiKeys);
  return (userId && snapshot.users.get(userId)) || [];
}
