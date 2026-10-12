import { createHash } from "node:crypto";

/**
 * A log line about a token that repeats on every request while the condition
 * lasts (an OAuth JWT without an `aud`, sent by a client at hundreds of
 * requests a minute) is written at most once per token per window. The line
 * that does get written carries how many were suppressed since the previous
 * one, so the rate stays readable from the log. The verdict the line reports
 * is still taken on every request; only the line is deduplicated.
 *
 * Keyed by the SHA-256 of the token so a heap dump or a debug print of the
 * map never exposes a usable credential. Map insertion order doubles as the
 * eviction order once the map is full. State is per replica.
 */
export interface PerTokenLogWindow {
  /**
   * Returns the number of lines suppressed since the token was last admitted
   * when this call should log, or `undefined` when it falls inside the window.
   */
  admit(token: string, now?: number): number | undefined;
  /** Test hook: forget every token. */
  reset(): void;
}

interface Entry {
  loggedAt: number;
  suppressed: number;
}

export function createPerTokenLogWindow(windowMs: number, maxEntries = 10_000): PerTokenLogWindow {
  const entries = new Map<string, Entry>();

  return {
    admit(token, now = Date.now()) {
      const key = createHash("sha256").update(token).digest("hex");
      const entry = entries.get(key);
      if (entry && now - entry.loggedAt < windowMs) {
        entry.suppressed += 1;
        return undefined;
      }
      const suppressed = entry?.suppressed ?? 0;
      entries.delete(key);
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      entries.set(key, { loggedAt: now, suppressed: 0 });
      return suppressed;
    },
    reset() {
      entries.clear();
    },
  };
}
