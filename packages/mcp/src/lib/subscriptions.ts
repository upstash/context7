// 16k stayed near baseline latency in Docker; 32,768 raised tools/list p95 to ~39 ms.
export const DEFAULT_MAX_SUBSCRIPTIONS = 16_000;

export function getMaxSubscriptions(value = process.env.MCP_MAX_SUBSCRIPTIONS): number {
  if (value === undefined) return DEFAULT_MAX_SUBSCRIPTIONS;

  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;

  console.warn(`Invalid MCP_MAX_SUBSCRIPTIONS; using the default of ${DEFAULT_MAX_SUBSCRIPTIONS}.`);
  return DEFAULT_MAX_SUBSCRIPTIONS;
}
