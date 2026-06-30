import { getRedis } from "./redis.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60; // 1 day — only extend TTL when below this
const SESSION_KEY_PREFIX = "#mcp#session#";

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

// Stateless store used when Redis is not configured. Each HTTP request already builds a
// fresh transport (sessionIdGenerator is undefined), so the server keeps no per-session
// state between requests — the store only existed to 404 sessions an instance doesn't
// recognize. On a single instance there is nothing to recognize, so we track nothing and
// accept every session ID. This means zero memory growth. Multi-instance deployments must
// configure Redis so sessions are shared (and validated) across replicas.
function createStatelessSessionStore(): SessionStore {
  return {
    async create() {},
    async refresh() {
      return true;
    },
    async delete() {},
  };
}

/**
 * Returns a session store for the HTTP transport. Uses Upstash Redis when
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (required for
 * multi-instance deployments where sessions must be shared across replicas), and
 * otherwise runs statelessly so the server works standalone without Redis.
 */
export function createSessionStore(): SessionStore {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return createRedisSessionStore(getRedis());
  }

  console.error(
    "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — running without session tracking. " +
      "This is fine for a single instance; configure Redis to share sessions across multiple instances."
  );
  return createStatelessSessionStore();
}
