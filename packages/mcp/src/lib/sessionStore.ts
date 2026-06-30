import { getRedis } from "./redis.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60; // 1 day — only extend TTL when below this
const SESSION_KEY_PREFIX = "#mcp#session#";

// Hard cap on entries in the in-memory store, bounding worst-case memory (~tens of MB) so a
// flood of initialize requests can't exhaust the heap. At capacity, the oldest session is
// evicted; an evicted-but-still-active client simply gets a 404 and re-initializes.
const MAX_MEMORY_SESSIONS = 100_000;

export interface SessionStore {
  create(sessionId: string): Promise<void>;
  refresh(sessionId: string): Promise<boolean>;
  delete(sessionId: string): Promise<void>;
}

// Fail-open: log Redis errors and proceed. The session ID isn't an auth/authz
// primitive — only an opaque identifier for log correlation and spec compliance —
// so an unreachable Redis shouldn't block clients. Ghost sessions self-heal on
// the next refresh (returns false → client gets 404 → re-inits).
function createRedisSessionStore(redis: ReturnType<typeof getRedis>): SessionStore {
  const getSessionKey = (sessionId: string) => `${SESSION_KEY_PREFIX}${sessionId}`;

  return {
    async create(sessionId: string) {
      try {
        await redis.set(getSessionKey(sessionId), "1", { ex: SESSION_TTL_SECONDS });
      } catch (err) {
        console.error(`Error creating Redis session record ${sessionId}:`, err);
      }
    },

    async refresh(sessionId: string) {
      try {
        // One TTL call tells us both whether the key exists AND how much time it has left.
        // Only issue an EXPIRE write when the key is approaching expiry
        const ttl = await redis.ttl(getSessionKey(sessionId));
        if (ttl < 0) return false;
        if (ttl < REFRESH_THRESHOLD_SECONDS) {
          await redis.expire(getSessionKey(sessionId), SESSION_TTL_SECONDS);
        }
        return true;
      } catch (err) {
        console.error(`Error refreshing Redis session record ${sessionId}:`, err);
        return true;
      }
    },

    async delete(sessionId: string) {
      try {
        await redis.del(getSessionKey(sessionId));
      } catch (err) {
        console.error(`Error deleting Redis session record ${sessionId}:`, err);
      }
    },
  };
}

// In-memory session store used when Redis is not configured. Sessions live in a
// Map keyed by session ID with an absolute expiry timestamp. This is correct for a
// single instance; it does not share sessions across replicas, so multi-instance
// deployments should configure Redis. Sessions are lost on restart, which is safe —
// clients get a 404 on the next request and re-initialize.
//
// Memory is bounded two ways: entries expire lazily on access (no scan), and the Map is
// capped at MAX_MEMORY_SESSIONS with oldest-first eviction on create. The Map's insertion
// order gives us that ordering for free; refreshing a session re-inserts it so active
// sessions move to the back and are evicted last (approximate LRU).
export function createMemorySessionStore(maxSessions = MAX_MEMORY_SESSIONS): SessionStore {
  const expiries = new Map<string, number>(); // sessionId -> expiry epoch ms

  return {
    async create(sessionId: string) {
      // Drop the entry first so re-creating an existing id doesn't keep its old position.
      expiries.delete(sessionId);
      // Evict oldest entries until there is room. Expired entries sort oldest, so they go first.
      while (expiries.size >= maxSessions) {
        const oldest = expiries.keys().next().value;
        if (oldest === undefined) break;
        expiries.delete(oldest);
      }
      expiries.set(sessionId, Date.now() + SESSION_TTL_SECONDS * 1000);
    },

    async refresh(sessionId: string) {
      const expiresAt = expiries.get(sessionId);
      if (expiresAt === undefined) return false;
      if (expiresAt <= Date.now()) {
        expiries.delete(sessionId);
        return false;
      }
      // Only extend the TTL when the session is approaching expiry. Re-insert so the entry
      // moves to the back of the eviction order (most-recently-used).
      if (expiresAt - Date.now() < REFRESH_THRESHOLD_SECONDS * 1000) {
        expiries.delete(sessionId);
        expiries.set(sessionId, Date.now() + SESSION_TTL_SECONDS * 1000);
      }
      return true;
    },

    async delete(sessionId: string) {
      expiries.delete(sessionId);
    },
  };
}

/**
 * Returns a session store for the HTTP transport. Uses Upstash Redis when
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (required for
 * multi-instance deployments where sessions must be shared), and falls back to
 * an in-memory store otherwise so the server runs standalone without Redis.
 */
export function createSessionStore(): SessionStore {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createRedisSessionStore(getRedis());
  }

  console.error(
    "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — using an in-memory session store. " +
      "This is fine for a single instance; configure Redis to share sessions across multiple instances."
  );
  return createMemorySessionStore();
}
