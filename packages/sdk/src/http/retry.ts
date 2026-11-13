import type { RetryConfig, RetryPolicy } from "./types";

export const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function createRetryPolicy(config?: RetryConfig): RetryPolicy {
  const retries = config === false ? 0 : (config?.retries ?? 5);
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError("retry.retries must be a non-negative integer");
  }

  return {
    retries,
    backoff: config === false ? () => 0 : (config?.backoff ?? defaultBackoff),
    statuses: new Set(config === false ? [] : (config?.statuses ?? DEFAULT_RETRY_STATUSES)),
  };
}

export function isTransientStatus(status: number): boolean {
  return DEFAULT_RETRY_STATUSES.has(status);
}

export function retryDelay(backoff: number, retryAfter?: number): number {
  return Math.max(backoff, retryAfter === undefined ? 0 : retryAfter * 1000);
}

function defaultBackoff(retryCount: number): number {
  return Math.exp(retryCount) * 50;
}
