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
  return oauthRequest<TokenData>(
    `${getBaseUrl()}/api/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLI_CLIENT_ID,
      refresh_token: refreshToken,
    }),
    "Failed to refresh token"
  );
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

async function describeErrorResponse(response: Response, fallback: string): Promise<string> {
  const body = await response.text().catch(() => "");

  try {
    const err = JSON.parse(body) as TokenErrorResponse;
    const message = err.error_description || err.error;
    if (message) return message;
  } catch {
    // An interceptor's HTML, not an OAuth error object.
  }

  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 200);
  const detail = `HTTP ${response.status} from ${response.url}`;
  return excerpt ? `${fallback} (${detail}): ${excerpt}` : `${fallback} (${detail})`;
}

const TLS_HINT =
  "The TLS certificate could not be verified, which usually means a proxy is inspecting HTTPS traffic. Point NODE_EXTRA_CA_CERTS at your organization's root CA.";
const DNS_HINT = "DNS lookup failed. Check your network or VPN connection.";
const BLOCKED_HINT =
  "The connection was refused or reset, which usually means a firewall or proxy is blocking it.";
const TIMEOUT_HINT = "The connection timed out. A proxy or firewall may be dropping the request.";
const DEFAULT_HINT =
  "If you are behind a corporate proxy, note that Node does not use HTTPS_PROXY automatically.";

const CONNECTION_HINTS: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: TLS_HINT,
  SELF_SIGNED_CERT_IN_CHAIN: TLS_HINT,
  DEPTH_ZERO_SELF_SIGNED_CERT: TLS_HINT,
  CERT_HAS_EXPIRED: TLS_HINT,
  ENOTFOUND: DNS_HINT,
  EAI_AGAIN: DNS_HINT,
  ECONNREFUSED: BLOCKED_HINT,
  ECONNRESET: BLOCKED_HINT,
  EHOSTUNREACH: BLOCKED_HINT,
  ENETUNREACH: BLOCKED_HINT,
  UND_ERR_CONNECT_TIMEOUT: TIMEOUT_HINT,
  ETIMEDOUT: TIMEOUT_HINT,
};

function getErrorCause(error: unknown): { code?: string; message?: string } {
  if (typeof error !== "object" || error === null || !("cause" in error)) return {};
  const cause = (error as { cause: unknown }).cause;
  if (typeof cause !== "object" || cause === null) return {};

  const { code, message } = cause as { code?: unknown; message?: unknown };
  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function describeConnectionError(error: unknown, url: string): string {
  const { code, message } = getErrorCause(error);
  const detail = message || (error instanceof Error ? error.message : String(error));
  const hint = (code && CONNECTION_HINTS[code]) || DEFAULT_HINT;

  return `Could not reach ${url}: ${detail}${code ? ` (${code})` : ""}\n${hint}`;
}

async function postForm(url: string, params: URLSearchParams): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (error) {
    throw new Error(describeConnectionError(error, url));
  }
}

async function oauthRequest<T>(url: string, params: URLSearchParams, fallback: string): Promise<T> {
  const response = await postForm(url, params);
  if (!response.ok) {
    throw new Error(await describeErrorResponse(response, fallback));
  }
  return (await response.json()) as T;
}

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

  return oauthRequest<DeviceAuthorizationResponse>(
    `${baseUrl}/api/oauth/device/code`,
    params,
    "Failed to start device authorization"
  );
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
    response = await postForm(
      `${baseUrl}/api/oauth/device/token`,
      new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: deviceCode,
        client_id: clientId,
      })
    );
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
