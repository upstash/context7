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

// How long setup waits for the stored key check before it uses the key as before.
const STORED_KEY_CHECK_TIMEOUT_MS = 10_000;

/**
 * The policy refusal for a stored API key, or null. A key saved before its teamspace limited
 * API keys is refused now, and writing it would leave the agent with a key that fails on every
 * call. /api/v2/auth/check is versioned, so the middleware answers a refused key with 403 and
 * the policy code, and it is not quota-tracked. Any other answer, or no answer, keeps the key.
 */
async function storedApiKeyRefusal(apiKey: string): Promise<ApiKeyPolicyRefusal | null> {
  try {
    const response = await fetch(`${getBaseUrl()}/api/v2/auth/check`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(STORED_KEY_CHECK_TIMEOUT_MS),
    });
    if (response.status !== 403) return null;
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    return isApiKeyPolicyRefusal(body.error) ? body.error : null;
  } catch {
    return null;
  }
}

export async function resolveSetupApiKey(): Promise<SetupApiKeyResult> {
  const storedToken = await getValidAccessToken({ recoverExpiredSession: false });
  let accessToken = storedToken;
  if (!accessToken) {
    const login = await performDeviceLogin();
    if (!login) return null;
    // The approval page refused a key for the chosen teamspace: setup continues with OAuth.
    if ("refusal" in login) return login;
    accessToken = login.token;
  }
  if (isContext7ApiKey(accessToken)) {
    // A key the device login just issued already passed the policy; a stored one may predate it.
    if (accessToken === storedToken) {
      const refusal = await storedApiKeyRefusal(accessToken);
      if (refusal) return { refusal };
    }
    return { apiKey: accessToken };
  }

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
