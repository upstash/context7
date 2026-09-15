// Context7's tools, prompts, and resources are static for the process lifetime,
// so notification subscriptions provide no useful events.
export const DEFAULT_MAX_SUBSCRIPTIONS = 0;

export function getMaxSubscriptions(value = process.env.MCP_MAX_SUBSCRIPTIONS): number {
  if (value === undefined) return DEFAULT_MAX_SUBSCRIPTIONS;

  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;

  console.warn(`Invalid MCP_MAX_SUBSCRIPTIONS; using the default of ${DEFAULT_MAX_SUBSCRIPTIONS}.`);
  return DEFAULT_MAX_SUBSCRIPTIONS;
}

export function isSubscriptionLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("subscription limit reached");
}

/** Drop cap-0 listen refusals; those are expected and drown Humio (~1M/day). */
export function logMcpHandlerError(label: string, error: unknown): void {
  if (isSubscriptionLimitError(error)) return;
  console.error(label, error);
}
