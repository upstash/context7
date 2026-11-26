import { credentialOwner } from "./credential-owner.js";
import { createSnapshotPoller } from "./snapshot-poller.js";
import { experimentalToolsFromChoice, type ExperimentalTool } from "./tool-names.js";

/**
 * The hosted server's copy of every user's experimental tools choice (snapshot-poller.ts), polled
 * from context7app `app/api/internal/mcp/experimental-tools-snapshot/route.ts`. Listing tools
 * never calls the Context7 API.
 */
export const SNAPSHOT_PATH = "/internal/mcp/experimental-tools-snapshot";

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

function parseSnapshot(value: unknown): Snapshot {
  const body = (value ?? {}) as SnapshotBody;
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

const poller = createSnapshotPoller({
  label: "experimental tools",
  path: SNAPSHOT_PATH,
  subject: "experimental-tools-snapshot",
  parse: parseSnapshot,
});

/** Whether this process takes experimental tools from the snapshot. */
export const isSnapshotEnabled = () => poller.enabled;
export const refreshSnapshot = poller.refresh;
export const startExperimentalToolsSnapshot = poller.start;
export const stopExperimentalToolsSnapshot = poller.stop;

/**
 * The caller's experimental tools from the snapshot, with no network call. Nothing is on for an
 * anonymous caller, an unknown credential, or before the first read.
 */
export function snapshotExperimentalTools(credential: string | undefined): ExperimentalTool[] {
  const snapshot = poller.current;
  if (!snapshot || !credential) return [];
  const owner = credentialOwner(credential);
  const userId =
    owner && ("userId" in owner ? owner.userId : snapshot.apiKeys.get(owner.apiKeyHash));
  return (userId && snapshot.users.get(userId)) || [];
}
