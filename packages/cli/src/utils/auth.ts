import * as fs from "fs";
import * as os from "os";
import { CLI_CLIENT_ID } from "../constants.js";
import { getBaseUrl } from "./api.js";
import {
  CREDENTIALS_FILE_NAME,
  getConfigDir,
  getCredentialsFilePath,
  getLegacyFilePath,
  migrateLegacyFileSync,
  resolveReadPathSync,
} from "./storage-paths.js";

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
}

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
}

// Credentials must never be group/world-readable, even if a migrated or
// pre-existing file carried looser permissions.
const CREDENTIALS_MODE = 0o600;

export function saveTokens(tokens: TokenData): void {
  const credentialsFile = getCredentialsFilePath();
  migrateLegacyFileSync(CREDENTIALS_FILE_NAME, credentialsFile, CREDENTIALS_MODE);
  ensureConfigDir();
  const data = {
    ...tokens,
    expires_at:
      tokens.expires_at ?? (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined),
  };
  fs.writeFileSync(credentialsFile, JSON.stringify(data, null, 2), { mode: CREDENTIALS_MODE });
  // `mode` is ignored when the file already exists; enforce it explicitly.
  fs.chmodSync(credentialsFile, CREDENTIALS_MODE);
}

export function loadTokens(): TokenData | null {
  const credentialsFile = resolveReadPathSync(
    CREDENTIALS_FILE_NAME,
    getCredentialsFilePath(),
    CREDENTIALS_MODE
  );
  if (!fs.existsSync(credentialsFile)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(credentialsFile, "utf-8"));
    return data as TokenData;
  } catch {
    return null;
  }
}

export function clearTokens(): boolean {
  const credentialsFile = getCredentialsFilePath();
  let removed = false;
  if (fs.existsSync(credentialsFile)) {
    fs.unlinkSync(credentialsFile);
    removed = true;
  }
  const legacyCredentialsFile = getLegacyFilePath(CREDENTIALS_FILE_NAME);
  if (fs.existsSync(legacyCredentialsFile)) {
    fs.unlinkSync(legacyCredentialsFile);
    removed = true;
  }
  return removed;
}

export function isTokenExpired(tokens: TokenData): boolean {
  if (!tokens.expires_at) {
    return false;
  }
  return Date.now() > tokens.expires_at - 60000;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const response = await fetch(`${getBaseUrl()}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLI_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as TokenErrorResponse;
    throw new Error(err.error_description || err.error || "Failed to refresh token");
  }

  return (await response.json()) as TokenData;
}

/**
 * Returns a valid access token, refreshing if expired. Returns null if no
 * tokens are stored or refresh fails. Pre-0.5 installs may have OAuth tokens
 * with a `refresh_token`; new installs hold long-lived API keys that never
 * expire and skip the refresh path entirely.
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  if (!isTokenExpired(tokens)) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    return null;
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    saveTokens(newTokens);
    return newTokens.access_token;
  } catch {
    return null;
  }
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
}

export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  /** Optional per RFC 8628 §3.2; clients MUST default to 5s when absent. */
  interval?: number;
}

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** RFC 8628 §3.2 default poll interval when the server omits `interval`. */
export const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;

export async function startDeviceAuthorization(
  baseUrl: string,
  clientId: string
): Promise<DeviceAuthorizationResponse> {
  // Hostname is shown on the server's verification page so the user can confirm
  // that the device they're authorizing matches the one running the CLI
  // (RFC 8628 §5.4 phishing resistance). Best-effort.
  const params = new URLSearchParams({ client_id: clientId });
  try {
    const hostname = os.hostname();
    if (hostname) params.set("hostname", hostname);
  } catch {
    // ignore
  }

  const response = await fetch(`${baseUrl}/api/oauth/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as TokenErrorResponse;
    throw new Error(err.error_description || err.error || "Failed to start device authorization");
  }

  return (await response.json()) as DeviceAuthorizationResponse;
}

export interface PollDeviceTokenResult {
  status: "approved" | "pending" | "slow_down" | "denied" | "expired" | "transient";
  tokens?: TokenData;
  errorMessage?: string;
}

export async function pollDeviceToken(
  baseUrl: string,
  clientId: string,
  deviceCode: string
): Promise<PollDeviceTokenResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/oauth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: deviceCode,
        client_id: clientId,
      }).toString(),
    });
  } catch (error) {
    // Network blip — keep polling.
    return {
      status: "transient",
      errorMessage: error instanceof Error ? error.message : "network error",
    };
  }

  if (response.ok) {
    const tokens = (await response.json()) as TokenData;
    return { status: "approved", tokens };
  }

  // Treat any 5xx as transient so a flaky backend doesn't end the user's session.
  if (response.status >= 500) {
    const err = (await response.json().catch(() => ({}))) as TokenErrorResponse;
    return {
      status: "transient",
      errorMessage: err.error_description || err.error || `HTTP ${response.status}`,
    };
  }

  const err = (await response.json().catch(() => ({}))) as TokenErrorResponse;
  switch (err.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    default:
      throw new Error(err.error_description || err.error || "Device token poll failed");
  }
}
