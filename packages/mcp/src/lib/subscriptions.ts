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

/** Suppress refusals from disabled subscriptions, but log capacity and other failures. */
export function logMcpHandlerError(label: string, error: unknown): void {
  if (
    error instanceof Error &&
    error.message === "subscriptions/listen refused: subscription limit reached (0)"
  ) {
    return;
  }
  console.error(label, error);
}
