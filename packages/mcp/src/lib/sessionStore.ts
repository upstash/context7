import { getRedis } from "./redis.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SESSION_KEY_PREFIX = "#mcp#session#";

export function createSessionStore() {
  const redis = getRedis();

  const getSessionKey = (sessionId: string) => `${SESSION_KEY_PREFIX}${sessionId}`;

  return {
    async create(sessionId: string) {
      await redis.set(getSessionKey(sessionId), "1", { ex: SESSION_TTL_SECONDS });
    },

    async refresh(sessionId: string) {
      try {
        return (await redis.expire(getSessionKey(sessionId), SESSION_TTL_SECONDS)) === 1;
      } catch (err) {
        console.error(`Error refreshing Redis session record ${sessionId}:`, err);
        return true;
      }
    },

    async delete(sessionId: string) {
      await redis.del(getSessionKey(sessionId));
    },
  };
}
