import { Redis } from "@upstash/redis";

let cached: Redis | undefined;

/**
 * Whether Upstash Redis credentials are configured.
 */
export function hasRedisCredentials(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Returns the shared Upstash Redis client. Throws if credentials are missing.
 */
export function getRedis(): Redis {
  if (cached) return cached;
  if (!hasRedisCredentials()) {
    throw new Error(
      "Upstash Redis credentials are required. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }
  cached = Redis.fromEnv();
  return cached;
}
