import { getRedis } from "./redis.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60; // 1 day — only extend TTL when below this
const SESSION_KEY_PREFIX = "#mcp#session#";

// Fail-open: log Redis errors and proceed. The session ID isn't an auth/authz
// primitive — only an opaque identifier for log correlation and spec compliance —
// so an unreachable Redis shouldn't block clients. Ghost sessions self-heal on
// the next refresh (returns false → client gets 404 → re-inits).
export function createSessionStore() {
  const redis = getRedis();

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
