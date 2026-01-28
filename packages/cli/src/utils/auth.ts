import * as crypto from "crypto";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".context7");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

export interface TokenData {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
}

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePKCE(): PKCEChallenge {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveTokens(tokens: TokenData): void {
  ensureConfigDir();
  const data = {
    ...tokens,
    expires_at:
      tokens.expires_at ?? (tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined),
  };
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function loadTokens(): TokenData | null {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
    return data as TokenData;
  } catch {
    return null;
  }
}

export function clearTokens(): boolean {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
    return true;
  }
  return false;
}

export function isTokenExpired(tokens: TokenData): boolean {
  if (!tokens.expires_at) {
    return false;
  }
  return Date.now() > tokens.expires_at - 60000;
}

export interface CallbackResult {
  code: string;
  state: string;
}

// Port for OAuth callback server - must match registered redirect URI
const CALLBACK_PORT = 52417;

export function createCallbackServer(expectedState: string): {
  port: Promise<number>;
  result: Promise<CallbackResult>;
  close: () => void;
} {
  let resolvePort: (port: number) => void;
  let resolveResult: (result: CallbackResult) => void;
  let rejectResult: (error: Error) => void;
  let serverInstance: http.Server | null = null;

  const portPromise = new Promise<number>((resolve) => {
    resolvePort = resolve;
  });

  const resultPromise = new Promise<CallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost`);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      res.writeHead(200, { "Content-Type": "text/html" });

      if (error) {
        res.end(errorPage(errorDescription || error));
        serverInstance?.close();
        rejectResult(new Error(errorDescription || error));
        return;
      }

      if (!code || !state) {
        res.end(errorPage("Missing authorization code or state"));
        serverInstance?.close();
        rejectResult(new Error("Missing authorization code or state"));
        return;
      }

      if (state !== expectedState) {
        res.end(errorPage("State mismatch - possible CSRF attack"));
        serverInstance?.close();
        rejectResult(new Error("State mismatch"));
        return;
      }

      res.end(successPage());
      serverInstance?.close();
      resolveResult({ code, state });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  serverInstance = server;

  server.on("error", (err) => {
    rejectResult(err as Error);
  });

  server.listen(CALLBACK_PORT, "127.0.0.1", () => {
    resolvePort(CALLBACK_PORT);
  });

  const timeout = setTimeout(
    () => {
      server.close();
      rejectResult(new Error("Login timed out after 5 minutes"));
    },
    5 * 60 * 1000
  );

  return {
    port: portPromise,
    result: resultPromise,
    close: () => {
      clearTimeout(timeout);
      server.close();
    },
  };
}

function successPage(): string {
  return `<!DOCTYPE html>
<html>
  <head><title>Login Successful</title></head>
  <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f9fafb;">
    <div style="text-align: center; padding: 2rem;">
      <div style="width: 64px; height: 64px; background: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
        <svg width="32" height="32" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24">
          <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 style="color: #16a34a; margin: 0 0 0.5rem;">Login Successful!</h1>
      <p style="color: #6b7280; margin: 0;">You can close this window and return to the terminal.</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function errorPage(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html>
  <head><title>Login Failed</title></head>
  <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f9fafb;">
    <div style="text-align: center; padding: 2rem;">
      <div style="width: 64px; height: 64px; background: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
        <svg width="32" height="32" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24">
          <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h1 style="color: #dc2626; margin: 0 0 0.5rem;">Login Failed</h1>
      <p style="color: #6b7280; margin: 0;">${safeMessage}</p>
      <p style="color: #9ca3af; margin: 1rem 0 0; font-size: 0.875rem;">You can close this window.</p>
    </div>
  </body>
</html>`;
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForTokens(
  baseUrl: string,
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId: string
): Promise<TokenData> {
  const response = await fetch(`${baseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as TokenErrorResponse;
    throw new Error(err.error_description || err.error || "Failed to exchange code for tokens");
  }

  return (await response.json()) as TokenData;
}

export function buildAuthorizationUrl(
  baseUrl: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  state: string
): string {
  const url = new URL(`${baseUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "profile email");
  url.searchParams.set("response_type", "code");
  return url.toString();
}
