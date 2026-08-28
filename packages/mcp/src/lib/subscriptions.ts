export const DEFAULT_MAX_SUBSCRIPTIONS = 4_096;

export function getMaxSubscriptions(value = process.env.MCP_MAX_SUBSCRIPTIONS): number {
  if (value === undefined) return DEFAULT_MAX_SUBSCRIPTIONS;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SUBSCRIPTIONS;
}
