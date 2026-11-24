import { randomBytes } from "crypto";
import ora from "ora";

import { performDeviceLogin } from "../commands/auth.js";
import { getBaseUrl, isApiKeyPolicyRefusal, type ApiKeyPolicyRefusal } from "../utils/api.js";
import { getValidAccessToken, isContext7ApiKey } from "../utils/auth.js";
import { log } from "../utils/logger.js";

export type SetupApiKeyResult =
  | { apiKey: string }
  /** The teamspace refuses this member an API key; only OAuth works for them. */
  | { refusal: ApiKeyPolicyRefusal }
  | null;

export async function resolveSetupApiKey(): Promise<SetupApiKeyResult> {
  let accessToken = await getValidAccessToken({ recoverExpiredSession: false });
  if (!accessToken) {
    const login = await performDeviceLogin();
    if (!login) return null;
    // The approval page refused a key for the chosen teamspace: setup continues with OAuth.
    if ("refusal" in login) return login;
    accessToken = login.token;
  }
  if (isContext7ApiKey(accessToken)) return { apiKey: accessToken };

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
      if (response.status === 403 && isApiKeyPolicyRefusal(err.error)) {
        spinner.stop();
        return { refusal: err.error };
      }
      spinner.fail("Authentication failed");
      log.error(err.message || err.error || `HTTP ${response.status}`);
      return null;
    }

    const result = (await response.json()) as { data: { apiKey: string } };
    spinner.succeed("Authenticated");
    return { apiKey: result.data.apiKey };
  } catch (err) {
    spinner.fail("Authentication failed");
    log.error(err instanceof Error ? err.message : String(err));
    return null;
  }
}
