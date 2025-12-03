# Sentry MCP OAuth Implementation Reference

This document contains the actual source code from the Sentry MCP server's OAuth implementation for reference.

**Source Repository**: [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp)
**OAuth Directory**: [packages/mcp-cloudflare/src/server/oauth](https://github.com/getsentry/sentry-mcp/tree/main/packages/mcp-cloudflare/src/server/oauth)

---

## File Structure

```
packages/mcp-cloudflare/src/server/oauth/
├── index.ts           # Main export (re-exports routes and helpers)
├── constants.ts       # OAuth URLs and Zod schemas
├── state.ts           # HMAC-signed state management
├── helpers.ts         # Token exchange and refresh logic
└── routes/
    ├── index.ts       # Hono router combining authorize + callback
    ├── authorize.ts   # Authorization endpoint
    └── callback.ts    # OAuth callback handler
```

---

## constants.ts

Defines Sentry OAuth endpoints and token response schema.

```typescript
import { z } from "zod";

// Sentry OAuth endpoints
export const SENTRY_AUTH_URL = "/oauth/authorize/";
export const SENTRY_TOKEN_URL = "/oauth/token/";

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(), // should be "bearer"
  expires_in: z.number(),
  expires_at: z.string().datetime(),
  user: z.object({
    email: z.string().email(),
    id: z.string(),
    name: z.string().nullable(),
  }),
  scope: z.string(),
});
```

---

## state.ts

HMAC-signed stateless OAuth state management using Web Crypto API.

```typescript
import { z } from "zod";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";

// Schema for OAuth state payload
const OAuthStateSchema = z.object({
  req: z.any(), // The downstream auth request data
  iat: z.number(), // Issued at timestamp
  exp: z.number(), // Expiration timestamp
});

export type OAuthState = z.infer<typeof OAuthStateSchema>;

// State token TTL (10 minutes)
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Import a secret string as a CryptoKey for HMAC-SHA256
 */
async function importKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Sign data and return hex-encoded signature
 */
async function signHex(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a hex-encoded signature
 */
async function verifyHex(signatureHex: string, data: string, secret: string): Promise<boolean> {
  const key = await importKey(secret);
  const encoder = new TextEncoder();
  try {
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );
    return await crypto.subtle.verify("HMAC", key, signatureBytes.buffer, encoder.encode(data));
  } catch {
    return false;
  }
}

/**
 * Create a signed state token
 * Format: ${signatureHex}.${base64(payload)}
 */
export async function signState(req: AuthRequest, secret: string): Promise<string> {
  const now = Date.now();
  const payload: OAuthState = {
    req,
    iat: now,
    exp: now + STATE_TTL_MS,
  };
  const data = JSON.stringify(payload);
  const signature = await signHex(data, secret);
  return `${signature}.${btoa(data)}`;
}

/**
 * Verify and parse a signed state token
 */
export async function verifyAndParseState(token: string, secret: string): Promise<OAuthState> {
  const [signatureHex, base64Payload] = token.split(".");

  if (!signatureHex || !base64Payload) {
    throw new Error("Invalid state format");
  }

  const data = atob(base64Payload);

  const isValid = await verifyHex(signatureHex, data, secret);
  if (!isValid) {
    throw new Error("Invalid state signature");
  }

  const parsed = OAuthStateSchema.parse(JSON.parse(data));

  if (parsed.exp < Date.now()) {
    throw new Error("State expired");
  }

  return parsed;
}
```

---

## helpers.ts

Token exchange and refresh logic with upstream Sentry OAuth.

```typescript
import { z } from "zod";
import { TokenResponseSchema, SENTRY_TOKEN_URL } from "./constants";
import { logError, logWarn } from "@sentry/mcp-core/telem/logging";

type TokenResponse = z.infer<typeof TokenResponseSchema>;

/**
 * Constructs an authorization URL for Sentry OAuth
 */
export function getUpstreamAuthorizeUrl(options: {
  upstream_url: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
}): string {
  const url = new URL(options.upstream_url);
  url.searchParams.set("client_id", options.client_id);
  url.searchParams.set("redirect_uri", options.redirect_uri);
  url.searchParams.set("scope", options.scope);
  url.searchParams.set("response_type", "code");
  if (options.state) {
    url.searchParams.set("state", options.state);
  }
  return url.href;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForAccessToken(options: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  code: string | undefined;
  redirect_uri: string;
}): Promise<[TokenResponse, null] | [null, Response]> {
  const { upstream_url, client_id, client_secret, code, redirect_uri } = options;

  if (!code) {
    return [null, new Response("Missing authorization code", { status: 400 })];
  }

  try {
    const response = await fetch(upstream_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id,
        client_secret,
        code,
        redirect_uri,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError("Failed to exchange code for token", {
        loggerScope: ["cloudflare", "oauth", "token"],
        extra: { status: response.status, error: errorText },
      });
      return [null, new Response("Failed to exchange authorization code", { status: 500 })];
    }

    const data = await response.json();
    const parsed = TokenResponseSchema.parse(data);
    return [parsed, null];
  } catch (error) {
    logError("Token exchange error", {
      loggerScope: ["cloudflare", "oauth", "token"],
      extra: { error: String(error) },
    });
    return [null, new Response("Token exchange failed", { status: 500 })];
  }
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(options: {
  upstream_url: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
}): Promise<[TokenResponse, null] | [null, Response]> {
  const { upstream_url, client_id, client_secret, refresh_token } = options;

  try {
    const response = await fetch(upstream_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id,
        client_secret,
        refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError("Failed to refresh token", {
        loggerScope: ["cloudflare", "oauth", "refresh"],
        extra: { status: response.status, error: errorText },
      });
      return [null, new Response("Failed to refresh token", { status: 500 })];
    }

    const data = await response.json();
    const parsed = TokenResponseSchema.parse(data);
    return [parsed, null];
  } catch (error) {
    logError("Token refresh error", {
      loggerScope: ["cloudflare", "oauth", "refresh"],
      extra: { error: String(error) },
    });
    return [null, new Response("Token refresh failed", { status: 500 })];
  }
}

/**
 * Token exchange callback for the OAuth provider
 * Called when tokens need to be refreshed
 */
export const tokenExchangeCallback = async (options: {
  grantType: string;
  props: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    [key: string]: unknown;
  };
  env: {
    SENTRY_HOST: string;
    SENTRY_CLIENT_ID: string;
    SENTRY_CLIENT_SECRET: string;
  };
}) => {
  if (options.grantType === "refresh_token") {
    const cachedExpiry = options.props.accessTokenExpiresAt;

    // Skip refresh if token still valid (with 2 minute buffer)
    if (cachedExpiry && cachedExpiry > Date.now() + 2 * 60 * 1000) {
      return {}; // Use cached token
    }

    // Refresh the upstream token
    const [payload, err] = await refreshAccessToken({
      upstream_url: new URL(
        SENTRY_TOKEN_URL,
        `https://${options.env.SENTRY_HOST || "sentry.io"}`
      ).href,
      client_id: options.env.SENTRY_CLIENT_ID,
      client_secret: options.env.SENTRY_CLIENT_SECRET,
      refresh_token: options.props.refreshToken,
    });

    if (err) {
      logWarn("Failed to refresh upstream token", {
        loggerScope: ["cloudflare", "oauth", "callback"],
      });
      return {};
    }

    return {
      accessTokenTTL: payload.expires_in,
      newProps: {
        ...options.props,
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
      },
    };
  }

  return {};
};
```

---

## routes/index.ts

Hono router combining authorize and callback routes.

```typescript
import { Hono } from "hono";
import type { Env } from "../../types";
import authorizeApp from "./authorize";
import callbackApp from "./callback";

// Compose and export the main OAuth Hono app
export default new Hono<{ Bindings: Env }>()
  .route("/authorize", authorizeApp)
  .route("/callback", callbackApp);
```

---

## routes/authorize.ts

Authorization endpoint - shows approval dialog and redirects to Sentry.

```typescript
import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../types";
import { SENTRY_AUTH_URL } from "../constants";
import { signState } from "../state";
import { getUpstreamAuthorizeUrl } from "../helpers";
import { renderApprovalDialog, addApprovedClient } from "../../lib/approval-dialog";
import { logWarn } from "@sentry/mcp-core/telem/logging";

export default new Hono<{ Bindings: Env }>()
  // GET /authorize - Show approval dialog
  .get("/", async (c) => {
    // Parse the OAuth request from the MCP client
    const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);

    if (!oauthReqInfo.clientId) {
      return c.text("Missing client_id", 400);
    }

    // Validate redirect URI
    if (!oauthReqInfo.redirectUri) {
      logWarn("Missing redirect_uri in authorization request", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: { clientId: oauthReqInfo.clientId },
      });
      return c.text("Missing redirect_uri", 400);
    }

    // Look up client metadata
    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);

    // Validate redirect URI is registered for this client
    if (!client?.redirectUris?.includes(oauthReqInfo.redirectUri)) {
      logWarn("Redirect URI not registered for client", {
        loggerScope: ["cloudflare", "oauth", "authorize"],
        extra: {
          clientId: oauthReqInfo.clientId,
          redirectUri: oauthReqInfo.redirectUri,
          registeredUris: client?.redirectUris,
        },
      });
      return c.text("Invalid redirect_uri", 400);
    }

    // Render approval dialog for user consent
    // Note: We always show the dialog to allow choosing permissions
    return renderApprovalDialog(c.req.raw, {
      client,
      oauthReqInfo,
      serverName: "Sentry MCP",
      serverDescription: "Connect your Sentry account to enable AI-powered issue management.",
    });
  })

  // POST /authorize - Handle approval form submission
  .post("/", async (c) => {
    const formData = await c.req.raw.formData();

    // Extract state from form (contains original OAuth request)
    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest; skills?: string[] };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return c.text("Invalid state data", 400);
    }

    const oauthReqInfo = state.oauthReqInfo;
    if (!oauthReqInfo?.clientId) {
      return c.text("Invalid OAuth request in state", 400);
    }

    // Validate redirect URI again
    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    if (!client?.redirectUris?.includes(oauthReqInfo.redirectUri!)) {
      return c.text("Invalid redirect_uri", 400);
    }

    // Add client to user's approved list (stored in encrypted cookie)
    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      oauthReqInfo.clientId,
      c.env.COOKIE_SECRET
    );

    // Create signed state token for the callback
    const stateToken = await signState(
      { ...oauthReqInfo, skills: state.skills } as AuthRequest,
      c.env.COOKIE_SECRET
    );

    // Build callback URL for Sentry to redirect back to
    const callbackUrl = new URL("/oauth/callback", c.req.url).href;

    // Redirect to Sentry's authorization endpoint
    const sentryAuthUrl = getUpstreamAuthorizeUrl({
      upstream_url: new URL(SENTRY_AUTH_URL, `https://${c.env.SENTRY_HOST || "sentry.io"}`).href,
      client_id: c.env.SENTRY_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: "openid profile email",
      state: stateToken,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: sentryAuthUrl,
        "Set-Cookie": approvedClientCookie,
      },
    });
  });
```

---

## routes/callback.ts

OAuth callback handler - exchanges code for token and completes authorization.

```typescript
import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env, WorkerProps } from "../../types";
import { SENTRY_TOKEN_URL } from "../constants";
import { exchangeCodeForAccessToken } from "../helpers";
import { verifyAndParseState, type OAuthState } from "../state";
import { clientIdAlreadyApproved } from "../../lib/approval-dialog";
import { logWarn } from "@sentry/mcp-core/telem/logging";
import { parseSkills, getScopesForSkills } from "@sentry/mcp-core/skills";

interface AuthRequestWithSkills extends AuthRequest {
  skills?: unknown;
}

export default new Hono<{ Bindings: Env }>().get("/", async (c) => {
  // 1. Verify and parse the state token
  let parsedState: OAuthState;
  try {
    const rawState = c.req.query("state") ?? "";
    parsedState = await verifyAndParseState(rawState, c.env.COOKIE_SECRET);
  } catch (err) {
    logWarn("Invalid state received on OAuth callback", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: { error: String(err) },
    });
    return c.text("Invalid state", 400);
  }

  const oauthReqInfo = parsedState.req as unknown as AuthRequestWithSkills;

  // 2. Validate required fields
  if (!oauthReqInfo.clientId) {
    logWarn("Missing clientId in OAuth state", {
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return c.text("Invalid state", 400);
  }

  if (!oauthReqInfo.redirectUri) {
    logWarn("Missing redirectUri in OAuth state", {
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return c.text("Authorization failed: No redirect URL provided", 400);
  }

  // 3. Validate redirect URI format
  try {
    new URL(oauthReqInfo.redirectUri);
  } catch {
    logWarn(`Invalid redirectUri in OAuth state: ${oauthReqInfo.redirectUri}`, {
      loggerScope: ["cloudflare", "oauth", "callback"],
    });
    return c.text("Authorization failed: Invalid redirect URL", 400);
  }

  // 4. Verify client was approved by user
  const isApproved = await clientIdAlreadyApproved(
    c.req.raw,
    oauthReqInfo.clientId,
    c.env.COOKIE_SECRET
  );
  if (!isApproved) {
    return c.text("Authorization failed: Client not approved", 403);
  }

  // 5. Validate redirect URI is registered for client
  try {
    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    const uriIsAllowed =
      Array.isArray(client?.redirectUris) &&
      client.redirectUris.includes(oauthReqInfo.redirectUri);
    if (!uriIsAllowed) {
      logWarn("Redirect URI not registered for client on callback", {
        loggerScope: ["cloudflare", "oauth", "callback"],
        extra: {
          clientId: oauthReqInfo.clientId,
          redirectUri: oauthReqInfo.redirectUri,
        },
      });
      return c.text("Authorization failed: Invalid redirect URL", 400);
    }
  } catch (lookupErr) {
    logWarn("Failed to validate client redirect URI on callback", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: { error: String(lookupErr) },
    });
    return c.text("Authorization failed: Invalid redirect URL", 400);
  }

  // 6. Exchange authorization code for access token with Sentry
  const sentryCallbackUrl = new URL("/oauth/callback", c.req.url).href;
  const [payload, errResponse] = await exchangeCodeForAccessToken({
    upstream_url: new URL(
      SENTRY_TOKEN_URL,
      `https://${c.env.SENTRY_HOST || "sentry.io"}`
    ).href,
    client_id: c.env.SENTRY_CLIENT_ID,
    client_secret: c.env.SENTRY_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: sentryCallbackUrl,
  });

  if (errResponse) {
    return errResponse;
  }

  // 7. Parse and validate requested skills/scopes
  const { valid: validSkills, invalid: invalidSkills } = parseSkills(oauthReqInfo.skills);

  if (invalidSkills.length > 0) {
    logWarn("OAuth callback received invalid skill names", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: {
        clientId: oauthReqInfo.clientId,
        invalidSkills,
      },
    });
  }

  if (validSkills.size === 0) {
    logWarn("OAuth authorization rejected: No valid skills selected", {
      loggerScope: ["cloudflare", "oauth", "callback"],
      extra: {
        clientId: oauthReqInfo.clientId,
        receivedSkills: oauthReqInfo.skills,
      },
    });
    return c.text(
      "Authorization failed: You must select at least one valid permission to continue.",
      400
    );
  }

  const grantedScopes = await getScopesForSkills(validSkills);
  const grantedSkills = Array.from(validSkills);

  // 8. Complete authorization - this issues the MCP access token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: payload.user.id,
    metadata: {
      label: payload.user.name,
    },
    scope: oauthReqInfo.scope,
    props: {
      // These props are encrypted and stored with the token
      id: payload.user.id,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      accessTokenExpiresAt: Date.now() + payload.expires_in * 1000,
      clientId: oauthReqInfo.clientId,
      scope: oauthReqInfo.scope.join(" "),
      grantedScopes: Array.from(grantedScopes),
      grantedSkills,
    } as WorkerProps,
  });

  // 9. Redirect back to MCP client with the access token
  return c.redirect(redirectTo);
});
```

---

## Main Server Setup (app.ts)

How the OAuth routes are integrated into the main server.

```typescript
import { Hono } from "hono";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";
import oauthApp from "./oauth";
import { tokenExchangeCallback } from "./oauth/helpers";
import { McpServer } from "./mcp-server";

// Create the main Hono app
const app = new Hono<{ Bindings: Env }>();

// Mount OAuth routes
app.route("/oauth", oauthApp);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Export with OAuth provider wrapper
export default new OAuthProvider({
  // API routes that require authentication
  apiRoute: ["/mcp", "/sse"],
  apiHandler: McpServer,

  // Default handler for non-API routes (OAuth, health, etc.)
  defaultHandler: app,

  // OAuth endpoint configuration
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",

  // Supported scopes
  scopesSupported: ["openid", "profile", "email"],

  // Token refresh callback
  tokenExchangeCallback,
});
```

---

## Environment Variables Required

```bash
# Sentry OAuth App credentials
SENTRY_CLIENT_ID=your-client-id
SENTRY_CLIENT_SECRET=your-client-secret
SENTRY_HOST=sentry.io  # or your self-hosted instance

# Cookie signing secret (32+ random characters)
COOKIE_SECRET=your-random-secret-key

# Cloudflare KV namespace for token storage
# (configured in wrangler.toml)
```

---

## Key Takeaways for Context7

1. **State Management**: Sentry uses HMAC-signed stateless tokens instead of storing state in a database. This is simpler but requires a `COOKIE_SECRET`.

2. **Upstream OAuth**: Sentry acts as an OAuth proxy - it authenticates with Sentry's OAuth, then issues its own MCP tokens. Context7 would authenticate with Clerk, then issue API keys.

3. **Cookie-based Approval**: Users' approved clients are stored in an encrypted cookie, avoiding database lookups on repeat authorizations.

4. **Token Refresh**: The `tokenExchangeCallback` handles refreshing upstream tokens when they expire.

5. **Cloudflare Workers OAuth Provider**: Sentry uses `@cloudflare/workers-oauth-provider` which handles most of the OAuth protocol. For Next.js, you'll implement these endpoints manually.

---

## Adapting for Context7 (Next.js)

The main differences for your implementation:

| Sentry (Cloudflare) | Context7 (Next.js) |
|---------------------|---------------------|
| `@cloudflare/workers-oauth-provider` | Manual route handlers |
| Hono framework | Next.js App Router |
| Cloudflare KV for storage | Supabase for storage |
| Sentry OAuth upstream | Clerk for user auth |
| Issues MCP tokens | Issues API keys |
| `COOKIE_SECRET` for state | Can use Supabase for state |

Your implementation will be simpler because:
- No upstream OAuth (Clerk handles user auth)
- Return API keys instead of MCP tokens
- Existing API key validation logic
