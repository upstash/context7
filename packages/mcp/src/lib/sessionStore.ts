import { Redis } from "@upstash/redis";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SESSION_KEY_PREFIX = "#mcp#session#";

function hasRedisCredentials() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function createSessionStore() {
  if (!hasRedisCredentials()) {
    throw new Error(
      "Upstash Redis credentials are required for MCP HTTP sessions. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }

  const redis = Redis.fromEnv();

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
        return (await redis.expire(getSessionKey(sessionId), SESSION_TTL_SECONDS)) === 1;
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
