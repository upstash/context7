import { getBaseUrl } from "./api.js";

export function trackEvent(event: string, data?: Record<string, unknown>): void {
  if (process.env.CTX7_TELEMETRY_DISABLED) return;
  fetch(`${getBaseUrl()}/api/v2/cli/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}
