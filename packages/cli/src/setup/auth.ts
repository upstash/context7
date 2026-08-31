import { randomBytes } from "crypto";
import ora from "ora";

import { performLogin } from "../commands/auth.js";
import { getBaseUrl } from "../utils/api.js";
import { getValidAccessToken, isContext7ApiKey } from "../utils/auth.js";
import { log } from "../utils/logger.js";

export async function resolveSetupApiKey(): Promise<string | null> {
  const accessToken = (await getValidAccessToken()) ?? (await performLogin());

  if (!accessToken) return null;
  if (isContext7ApiKey(accessToken)) return accessToken;

  const spinner = ora("Configuring authentication...").start();

  try {
    const response = await fetch(`${getBaseUrl()}/api/dashboard/api-keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: `ctx7-cli-${randomBytes(3).toString("hex")}` }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      spinner.fail("Authentication failed");
      log.error(err.message || err.error || `HTTP ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { data: { apiKey: string } };
    spinner.succeed("Authenticated");
    return result.data.apiKey;
  } catch (err) {
    spinner.fail("Authentication failed");
    log.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}
