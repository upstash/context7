import { CONTEXT7_API_BASE_URL } from "./constants.js";
import { hasMcpAssertionKey, sealMcpAssertion } from "./encryption.js";

/**
 * Keeps an in-memory copy of one of the app's internal snapshots, the way feature flag SDKs
 * evaluate flags locally (LaunchDarkly, Unleash): requests read only the copy, never the Context7
 * API, so traffic cannot turn into lookups (the CTX7-3866 incident). Each process polls the route
 * every POLL_MS with the version it holds; without a change the app answers 204 after one Redis
 * read. The version goes in SNAPSHOT_VERSION_HEADER because Vercel's CDN removes `If-None-Match`
 * before the app's function sees it; `If-None-Match` stays for apps from before the header.
 *
 * The routes (context7app `app/api/internal/mcp/*`) are for the hosted server only: they are
 * authenticated with an assertion sealed with the key the app shares with it
 * (`MCP_CLIENT_IP_ASSERTION_KEY`), so a process without that key does not poll.
 */

/** Keep in step with the app's `SNAPSHOT_VERSION_HEADER` (`lib/mcp/snapshotResponse.ts`). */
const SNAPSHOT_VERSION_HEADER = "X-Context7-Snapshot-Version";
/** Keep in step with the app's `hasMcpServerAssertion`: the tag of every internal MCP route. */
const ASSERTION_TAG = "s1";
const POLL_MS = 15_000;
/** Poll interval while no snapshot was ever read, so a process that started during a blip recovers fast. */
const FIRST_READ_RETRY_MS = 2_000;
export const SNAPSHOT_REQUEST_TIMEOUT_MS = 5_000;
/** At most this many failures in a row are logged; the next success says it recovered. */
const LOGGED_FAILURES = 3;

/** The header that authenticates a request to the internal route whose assertion plaintext is `subject`. */
export function mcpAssertionHeader(subject: string): Record<string, string> {
  const assertion = sealMcpAssertion(ASSERTION_TAG, subject);
  if (!assertion) throw new Error("the MCP assertion could not be sealed");
  return { "X-Context7-Mcp-Assertion": assertion };
}

export interface SnapshotPoller<T> {
  /** Whether this process polls (it holds the assertion key). */
  readonly enabled: boolean;
  /** The last snapshot read, kept through failed polls. */
  readonly current: T | undefined;
  /** When the app last answered a poll (200, or 204/304 for no change); 0 before the first answer. */
  readonly lastReadAt: number;
  /** One poll: a 204 or 304 keeps the copy, a 200 replaces it. Never throws. */
  refresh(): Promise<void>;
  /**
   * Starts polling when `canAuthenticate`. The first read is awaited, up to
   * SNAPSHOT_REQUEST_TIMEOUT_MS, so a new process answers from its first request.
   */
  start(canAuthenticate?: boolean): Promise<void>;
  /** Stops polling and forgets the copy. */
  stop(): void;
}

export function createSnapshotPoller<T extends { version: string }>(options: {
  /** For log lines: "experimental tools", "team skills". */
  label: string;
  path: string;
  /** The assertion plaintext the route expects. */
  subject: string;
  parse: (body: unknown) => T;
}): SnapshotPoller<T> {
  let enabled = false;
  let current: T | undefined;
  let lastReadAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failuresInRow = 0;

  async function refresh(): Promise<void> {
    if (!enabled) return;
    try {
      const response = await fetch(`${CONTEXT7_API_BASE_URL}${options.path}`, {
        headers: {
          ...mcpAssertionHeader(options.subject),
          ...(current && {
            [SNAPSHOT_VERSION_HEADER]: current.version,
            "If-None-Match": `"${current.version}"`,
          }),
        },
        signal: AbortSignal.timeout(SNAPSHOT_REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 204 && response.status !== 304) {
        if (!response.ok) throw new Error(`the Context7 API answered HTTP ${response.status}`);
        current = options.parse(await response.json());
      }
      lastReadAt = Date.now();
      if (failuresInRow > 0) {
        console.error(
          `[Context7] ${options.label} snapshot read again after ${failuresInRow} failures`
        );
      }
      failuresInRow = 0;
    } catch (error) {
      // Keep serving the last snapshot through an outage of the app.
      failuresInRow++;
      if (failuresInRow <= LOGGED_FAILURES) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[Context7] Could not read the ${options.label} snapshot (${reason}); keeping the ${
            current ? `version ${current.version}` : "empty list"
          }`
        );
      }
    }
  }

  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    enabled = false;
    current = undefined;
    lastReadAt = 0;
    failuresInRow = 0;
  }

  async function start(canAuthenticate = hasMcpAssertionKey()): Promise<void> {
    stop();
    enabled = canAuthenticate;
    if (!enabled) return;
    await refresh();
    const schedule = () => {
      // Jitter keeps the processes of one deployment from polling in step.
      timer = setTimeout(
        async () => {
          await refresh();
          schedule();
        },
        (current ? POLL_MS : FIRST_READ_RETRY_MS) + Math.floor(Math.random() * 2_000)
      );
      timer.unref?.();
    };
    schedule();
  }

  return {
    get enabled() {
      return enabled;
    },
    get current() {
      return current;
    },
    get lastReadAt() {
      return lastReadAt;
    },
    refresh,
    start,
    stop,
  };
}
