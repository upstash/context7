# OAuth Architecture Plan for Context7 MCP

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Detailed OAuth Flow](#detailed-oauth-flow)
4. [Implementation](#implementation)
5. [Database Schema](#database-schema)
6. [File Structure](#file-structure)
7. [Implementation Checklist](#implementation-checklist)
8. [References](#references)

---

## Overview

This document outlines the OAuth 2.1 implementation for the Context7 MCP server, enabling MCP clients (Claude Desktop, Cursor, VS Code) to authenticate users via the Context7app Next.js backend.

### Key Decisions

| Decision                 | Choice                      | Rationale                                            |
| ------------------------ | --------------------------- | ---------------------------------------------------- |
| **Authorization Server** | context7app (Next.js)       | Already has Clerk auth and Supabase                  |
| **Resource Server**      | context7 MCP                | Validates API keys, serves MCP tools                 |
| **Token Type**           | API Key (not JWT)           | Zero changes to existing API validation              |
| **Client Registration**  | Dynamic (RFC 7591)          | Required by MCP spec                                 |
| **User Authentication**  | Clerk                       | Existing auth system                                 |
| **Storage**              | Supabase                    | Existing database                                    |

### Why API Keys Instead of JWT?

The OAuth flow returns an **API key** as the `access_token`:

- Reuses existing `member_api_keys` table and validation logic
- No changes needed to the MCP server's API key validation
- Consistent behavior whether user gets key via OAuth or dashboard
- Simple revocation (delete the key from database)

### API Key Regeneration on OAuth Flow

Since we only store **hashed** API keys (not the originals), a **new API key is generated each OAuth flow**. This is handled safely using a `source` column:

| Scenario | Behavior |
|----------|----------|
| First OAuth connection | Creates new API key with `source: "mcp-oauth"` |
| Subsequent OAuth connections | Regenerates only the `mcp-oauth` key |
| Manual API keys (dashboard) | **Unaffected** - they have `source: "manual"` |

**Why this is acceptable:**
- OAuth access tokens are typically regenerated on each authorization - this is expected behavior
- Each reconnection only invalidates the previous OAuth-issued key
- Manual API keys created via dashboard remain valid
- Clear separation between OAuth-issued and manually-created keys

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP Client                                      │
│                    (Claude Desktop, Cursor, VS Code)                         │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
┌───────────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐
│   Context7 MCP        │  │    Context7app        │  │       Clerk           │
│   (Resource Server)   │  │  (Auth Server)        │  │   (Identity Provider) │
│                       │  │                       │  │                       │
│ • Serves MCP tools    │  │ • OAuth endpoints     │  │ • User login UI       │
│ • Validates API keys  │  │ • Issues API keys     │  │ • Session management  │
│ • Returns 401 if      │  │ • Client registration │  │ • User database       │
│   unauthenticated     │  │ • PKCE verification   │  │                       │
│                       │  │                       │  │                       │
│ packages/mcp/         │  │ context7app/          │  │ clerk.com             │
└───────────────────────┘  └───────────────────────┘  └───────────────────────┘
         │                            │
         │                            │
         ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Supabase                                        │
│                                                                             │
│  • member_api_keys (existing)    • mcp_oauth_clients (new)                  │
│  • users (existing)              • mcp_auth_codes (new)                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Endpoint Overview

| Component     | Endpoint                                  | Purpose                          |
| ------------- | ----------------------------------------- | -------------------------------- |
| context7app   | `/.well-known/oauth-protected-resource`   | RFC 9728 resource metadata       |
| context7app   | `/.well-known/oauth-authorization-server` | RFC 8414 auth server metadata    |
| context7app   | `/api/mcp-auth/register`                  | Dynamic client registration      |
| context7app   | `/api/mcp-auth/authorize`                 | Authorization endpoint           |
| context7app   | `/api/mcp-auth/token`                     | Token exchange (returns API key) |
| context7 MCP  | `/mcp`                                    | MCP protocol endpoint            |

---

## Detailed OAuth Flow

### Sequence Diagram

```
┌──────────┐          ┌──────────┐          ┌──────────┐          ┌──────────┐
│MCP Client│          │Context7  │          │Context7  │          │  Clerk   │
│(Claude)  │          │   MCP    │          │   app    │          │          │
└────┬─────┘          └────┬─────┘          └────┬─────┘          └────┬─────┘
     │                     │                     │                     │
     │ ══════════════════════════════════════════════════════════════════════
     │ PHASE 1: DISCOVERY
     │ ══════════════════════════════════════════════════════════════════════
     │                     │                     │                     │
     │  1. Connect (no token)                    │                     │
     ├────────────────────►│                     │                     │
     │                     │                     │                     │
     │  2. 401 Unauthorized                      │                     │
     │     WWW-Authenticate: Bearer              │                     │
     │     resource_metadata="/.well-known/..."  │                     │
     │◄────────────────────┤                     │                     │
     │                     │                     │                     │
     │  3. GET /.well-known/oauth-protected-resource                   │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │  4. { authorization_servers: ["https://context7.com"] }         │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │  5. GET /.well-known/oauth-authorization-server                 │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │  6. { authorization_endpoint, token_endpoint, ... }             │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │ ══════════════════════════════════════════════════════════════════════
     │ PHASE 2: CLIENT REGISTRATION (first time only)
     │ ══════════════════════════════════════════════════════════════════════
     │                     │                     │                     │
     │  7. POST /api/mcp-auth/register           │                     │
     │     { redirect_uris, client_name }        │                     │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │                     │                     │ Store in            │
     │                     │                     │ mcp_oauth_clients   │
     │                     │                     ├──┐                  │
     │                     │                     │  │                  │
     │                     │                     │◄─┘                  │
     │                     │                     │                     │
     │  8. { client_id: "uuid-xxx" }             │                     │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │ ══════════════════════════════════════════════════════════════════════
     │ PHASE 3: AUTHORIZATION (PKCE)
     │ ══════════════════════════════════════════════════════════════════════
     │                     │                     │                     │
     │  Generate code_verifier (random)          │                     │
     │  code_challenge = SHA256(code_verifier)   │                     │
     ├──┐                  │                     │                     │
     │  │                  │                     │                     │
     │◄─┘                  │                     │                     │
     │                     │                     │                     │
     │  9. Open browser: /api/mcp-auth/authorize │                     │
     │     ?client_id=xxx                        │                     │
     │     &redirect_uri=http://127.0.0.1:xxx    │                     │
     │     &code_challenge=yyy                   │                     │
     │     &code_challenge_method=S256           │                     │
     │     &state=random-state                   │                     │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │                     │                     │  10. Check session  │
     │                     │                     ├────────────────────►│
     │                     │                     │                     │
     │                     │                     │  11. No session     │
     │                     │                     │◄────────────────────┤
     │                     │                     │                     │
     │  12. Redirect to /sign-in?redirect_url=...│                     │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │  13. User enters credentials              │                     │
     ├─────────────────────────────────────────────────────────────────►
     │                     │                     │                     │
     │  14. Session created                      │                     │
     │◄─────────────────────────────────────────────────────────────────
     │                     │                     │                     │
     │  15. Redirect back to /api/mcp-auth/authorize (with session)    │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │                     │                     │  16. Verify session │
     │                     │                     ├────────────────────►│
     │                     │                     │                     │
     │                     │                     │  17. userId         │
     │                     │                     │◄────────────────────┤
     │                     │                     │                     │
     │                     │                     │ 18. Generate auth   │
     │                     │                     │     code, store     │
     │                     │                     │     with PKCE       │
     │                     │                     │     challenge       │
     │                     │                     ├──┐                  │
     │                     │                     │  │                  │
     │                     │                     │◄─┘                  │
     │                     │                     │                     │
     │  19. Redirect to redirect_uri?code=xxx&state=yyy                │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │ ══════════════════════════════════════════════════════════════════════
     │ PHASE 4: TOKEN EXCHANGE
     │ ══════════════════════════════════════════════════════════════════════
     │                     │                     │                     │
     │  20. POST /api/mcp-auth/token             │                     │
     │      grant_type=authorization_code        │                     │
     │      code=xxx                             │                     │
     │      code_verifier=original-verifier      │                     │
     │      redirect_uri=http://127.0.0.1:xxx    │                     │
     ├──────────────────────────────────────────►│                     │
     │                     │                     │                     │
     │                     │                     │ 21. Validate code   │
     │                     │                     │     Verify PKCE:    │
     │                     │                     │     SHA256(verifier)│
     │                     │                     │     == challenge    │
     │                     │                     ├──┐                  │
     │                     │                     │  │                  │
     │                     │                     │◄─┘                  │
     │                     │                     │                     │
     │                     │                     │ 22. Get/create      │
     │                     │                     │     API key for     │
     │                     │                     │     user            │
     │                     │                     ├──┐                  │
     │                     │                     │  │                  │
     │                     │                     │◄─┘                  │
     │                     │                     │                     │
     │  23. { access_token: "ctx7sk-xxx", token_type: "Bearer" }       │
     │◄──────────────────────────────────────────┤                     │
     │                     │                     │                     │
     │  Store API key      │                     │                     │
     ├──┐                  │                     │                     │
     │  │                  │                     │                     │
     │◄─┘                  │                     │                     │
     │                     │                     │                     │
     │ ══════════════════════════════════════════════════════════════════════
     │ PHASE 5: AUTHENTICATED MCP REQUESTS
     │ ══════════════════════════════════════════════════════════════════════
     │                     │                     │                     │
     │  24. MCP Request    │                     │                     │
     │      Authorization: Bearer ctx7sk-xxx     │                     │
     ├────────────────────►│                     │                     │
     │                     │                     │                     │
     │                     │ 25. Validate API key│                     │
     │                     │     (existing logic)│                     │
     │                     ├──┐                  │                     │
     │                     │  │                  │                     │
     │                     │◄─┘                  │                     │
     │                     │                     │                     │
     │  26. MCP Response   │                     │                     │
     │◄────────────────────┤                     │                     │
     │                     │                     │                     │
```

### Step-by-Step Breakdown

---

#### Phase 1: Discovery

**What happens:** The MCP client learns where and how to authenticate.

**Step 1 — MCP Client connects without credentials**

When the user adds the Context7 MCP server to their client (Cursor, Claude Desktop), the client automatically attempts to connect:

```
GET https://mcp.context7.com/mcp
(no Authorization header)
```

**Step 2 — MCP Server returns 401 with OAuth metadata location**

Since there's no token, the MCP server rejects the request but tells the client where to find authentication info:

```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://context7.com/.well-known/oauth-protected-resource"
```

**Step 3 — MCP Client fetches Protected Resource Metadata**

The client reads the URL from the `WWW-Authenticate` header and fetches it:

```
GET https://context7.com/.well-known/oauth-protected-resource
```

**Step 4 — Context7app returns resource metadata**

This tells the client which authorization server to use:

```json
{
  "resource": "https://mcp.context7.com/mcp",
  "authorization_servers": ["https://context7.com"]
}
```

**Step 5 — MCP Client fetches Authorization Server Metadata**

Now the client knows to look at `context7.com`, so it fetches the OAuth configuration:

```
GET https://context7.com/.well-known/oauth-authorization-server
```

**Step 6 — Context7app returns OAuth endpoints**

This tells the client all the URLs it needs for the OAuth flow:

```json
{
  "authorization_endpoint": "https://context7.com/api/mcp-auth/authorize",
  "token_endpoint": "https://context7.com/api/mcp-auth/token",
  "registration_endpoint": "https://context7.com/api/mcp-auth/register",
  "code_challenge_methods_supported": ["S256"]
}
```

---

#### Phase 2: Client Registration (First Time Only)

**What happens:** The MCP client registers itself to get a `client_id`. This only happens once per client.

**Step 7 — MCP Client registers itself**

The client sends its information to get a unique identifier:

```
POST https://context7.com/api/mcp-auth/register
Content-Type: application/json

{
  "client_name": "Cursor",
  "redirect_uris": ["http://127.0.0.1:54321/callback"]
}
```

**Step 8 — Context7app stores client and returns `client_id`**

The server creates a record in `mcp_oauth_clients` and responds:

```json
{
  "client_id": "550e8400-e29b-41d4-a716-446655440000",
  "client_name": "Cursor",
  "redirect_uris": ["http://127.0.0.1:54321/callback"]
}
```

The client saves this `client_id` for future use.

---

#### Phase 3: Authorization (PKCE Flow)

**What happens:** The user logs in via browser, and the client gets an authorization code.

**Step 9 — MCP Client generates PKCE values and opens browser**

The client creates a random `code_verifier` and computes its SHA256 hash (`code_challenge`). Then it opens the user's browser:

```
https://context7.com/api/mcp-auth/authorize
  ?client_id=550e8400-e29b-41d4-a716-446655440000
  &redirect_uri=http://127.0.0.1:54321/callback
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
  &state=xyz123
```

**Step 10-11 — Context7app checks for Clerk session**

The authorize endpoint checks if the user is already logged in with Clerk. If not, there's no session.

**Step 12 — Context7app redirects to sign-in**

Since the user isn't logged in, they're redirected to the Clerk sign-in page:

```
HTTP/1.1 302 Found
Location: https://context7.com/sign-in?redirect_url=https://context7.com/api/mcp-auth/authorize?client_id=...
```

**Step 13-14 — User logs in with Clerk**

The user sees the Context7 login page and enters their credentials (or uses Google/GitHub SSO). Clerk authenticates them and creates a session.

**Step 15 — Browser redirects back to authorize endpoint**

After successful login, Clerk redirects back to the original authorize URL, now with a valid session cookie.

**Step 16-17 — Context7app verifies session and gets user info**

The authorize endpoint now detects the Clerk session and retrieves the `userId`.

**Step 18 — Context7app generates authorization code**

A random authorization code is generated and stored in `mcp_auth_codes` along with:
- The `client_id`
- The `user_id`
- The `code_challenge` (for PKCE verification later)
- Expiration time (10 minutes)

**Step 19 — Context7app redirects to client with code**

The browser is redirected to the client's callback URL:

```
HTTP/1.1 302 Found
Location: http://127.0.0.1:54321/callback?code=SplxlOBeZQQYbYS6WxSbIA&state=xyz123
```

The MCP client (listening on localhost) receives this callback.

---

#### Phase 4: Token Exchange

**What happens:** The client exchanges the authorization code for an API key.

**Step 20 — MCP Client sends token request**

The client sends the code along with the original `code_verifier` (not the hash):

```
POST https://context7.com/api/mcp-auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
&redirect_uri=http://127.0.0.1:54321/callback
```

**Step 21 — Context7app validates code and PKCE**

The server:
1. Looks up the code in `mcp_auth_codes`
2. Checks it hasn't expired or been used
3. Computes `SHA256(code_verifier)` and verifies it matches the stored `code_challenge`

This proves the same client that started the flow is completing it (prevents code interception attacks).

**Step 22 — Context7app creates/regenerates API key**

The server checks if this user already has an OAuth-issued API key (`source: "mcp-oauth"`):
- **If yes:** Regenerates it (updates the hash in database)
- **If no:** Creates a new API key with `source: "mcp-oauth"`

Manual API keys (`source: "manual"`) are never affected.

**Step 23 — Context7app returns the API key as access_token**

```json
{
  "access_token": "ctx7sk-abc123def456...",
  "token_type": "Bearer",
  "expires_in": 31536000,
  "scope": "mcp:read"
}
```

The MCP client stores this token securely.

---

#### Phase 5: Authenticated Requests

**What happens:** The client can now use Context7 MCP tools.

**Step 24 — MCP Client sends authenticated requests**

All subsequent MCP requests include the API key:

```
POST https://mcp.context7.com/mcp
Authorization: Bearer ctx7sk-abc123def456...
Content-Type: application/json

{"method": "tools/call", "params": {"name": "get-library-docs", ...}}
```

**Step 25 — MCP Server validates API key**

The server extracts the token from the `Authorization` header and validates it against `member_api_keys` using the existing API key validation logic. No changes needed here.

**Step 26 — MCP Server returns response**

```json
{
  "result": {
    "content": [{"type": "text", "text": "Documentation for react..."}]
  }
}
```

The user can now use all Context7 MCP tools normally.

---

### User Experience Summary

From the user's perspective, the entire flow looks like:

1. **Add server to config** (one-time)
2. **Restart client** (Cursor/Claude Desktop)
3. **Browser opens** → Login with existing Context7 account
4. **Done** — tools work automatically

Subsequent sessions reuse the stored token. Re-authentication only happens if the token is revoked or the user removes the server config.

---

## Implementation

### Context7app Routes

#### 1. Protected Resource Metadata

**File:** `app/.well-known/oauth-protected-resource/route.ts`

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://context7.com";

  return NextResponse.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    scopes_supported: ["mcp:read", "mcp:write"],
    bearer_methods_supported: ["header"],
  });
}
```

#### 2. Authorization Server Metadata

**File:** `app/.well-known/oauth-authorization-server/route.ts`

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://context7.com";

  return NextResponse.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/mcp-auth/authorize`,
    token_endpoint: `${baseUrl}/api/mcp-auth/token`,
    registration_endpoint: `${baseUrl}/api/mcp-auth/register`,
    scopes_supported: ["mcp:read", "mcp:write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
```

#### 3. Client Registration

**File:** `app/api/mcp-auth/register/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/serverClient";
import crypto from "crypto";

export async function POST(request: Request) {
  const body = await request.json();
  const { redirect_uris, client_name, client_uri } = body;

  // Validate redirect URIs
  if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris required" },
      { status: 400 }
    );
  }

  // Validate each URI
  for (const uri of redirect_uris) {
    try {
      const url = new URL(uri);
      // Allow localhost and 127.0.0.1 for development
      if (!["http:", "https:"].includes(url.protocol)) {
        return NextResponse.json(
          { error: "invalid_redirect_uri", error_description: "Invalid protocol" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "invalid_redirect_uri", error_description: "Invalid URL" },
        { status: 400 }
      );
    }
  }

  const supabase = createClient();
  const clientId = crypto.randomUUID();

  const { error } = await supabase.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: client_name || null,
    client_uri: client_uri || null,
    redirect_uris: redirect_uris,
  });

  if (error) {
    console.error("Failed to register client:", error);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to register client" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: client_name,
      redirect_uris: redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201 }
  );
}
```

#### 4. Authorization Endpoint

**File:** `app/api/mcp-auth/authorize/route.ts`

```typescript
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/serverClient";
import crypto from "crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);

  // Extract OAuth parameters
  const client_id = url.searchParams.get("client_id");
  const redirect_uri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const code_challenge = url.searchParams.get("code_challenge");
  const code_challenge_method = url.searchParams.get("code_challenge_method");
  const scope = url.searchParams.get("scope") || "mcp:read";

  // Validate required parameters
  if (!client_id) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "client_id required" },
      { status: 400 }
    );
  }

  if (!redirect_uri) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri required" },
      { status: 400 }
    );
  }

  // Validate PKCE (required by MCP spec)
  if (!code_challenge || code_challenge_method !== "S256") {
    return NextResponse.json(
      { error: "invalid_request", error_description: "PKCE with S256 required" },
      { status: 400 }
    );
  }

  // Validate client exists and redirect_uri is registered
  const supabase = createClient();
  const { data: client } = await supabase
    .from("mcp_oauth_clients")
    .select("*")
    .eq("client_id", client_id)
    .single();

  if (!client) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown client_id" },
      { status: 400 }
    );
  }

  if (!client.redirect_uris.includes(redirect_uri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not registered" },
      { status: 400 }
    );
  }

  // Check if user is authenticated with Clerk
  const { userId } = await auth();

  if (!userId) {
    // Redirect to sign-in, then back here
    const returnUrl = encodeURIComponent(request.url);
    return redirect(`/sign-in?redirect_url=${returnUrl}`);
  }

  // User is authenticated - generate authorization code
  const authCode = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store auth code with PKCE challenge
  const { error: insertError } = await supabase.from("mcp_auth_codes").insert({
    code: authCode,
    client_id: client_id,
    user_id: userId,
    redirect_uri: redirect_uri,
    code_challenge: code_challenge,
    scope: scope,
    expires_at: expiresAt.toISOString(),
  });

  if (insertError) {
    console.error("Failed to store auth code:", insertError);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to generate code" },
      { status: 500 }
    );
  }

  // Redirect back to client with code
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", authCode);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return redirect(redirectUrl.toString());
}
```

#### 5. Token Endpoint

**File:** `app/api/mcp-auth/token/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/serverClient";
import { generateApiKey, hashApiKey } from "@/lib/dashboard/apiKey";
import crypto from "crypto";

export async function POST(request: Request) {
  // Parse form data (OAuth spec requires application/x-www-form-urlencoded)
  const contentType = request.headers.get("content-type") || "";
  let params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      params[key] = value.toString();
    });
  } else if (contentType.includes("application/json")) {
    params = await request.json();
  } else {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid content type" },
      { status: 400 }
    );
  }

  const { grant_type, code, code_verifier, redirect_uri } = params;

  // Only support authorization_code grant
  if (grant_type !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 }
    );
  }

  if (!code || !code_verifier || !redirect_uri) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters" },
      { status: 400 }
    );
  }

  const supabase = createClient();

  // Fetch and validate auth code
  const { data: authCode } = await supabase
    .from("mcp_auth_codes")
    .select("*")
    .eq("code", code)
    .eq("consumed", false)
    .single();

  if (!authCode) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Invalid or expired code" },
      { status: 400 }
    );
  }

  // Check expiration
  if (new Date(authCode.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Code expired" },
      { status: 400 }
    );
  }

  // Verify redirect_uri matches
  if (authCode.redirect_uri !== redirect_uri) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      { status: 400 }
    );
  }

  // Verify PKCE: SHA256(code_verifier) must equal stored code_challenge
  const computedChallenge = crypto
    .createHash("sha256")
    .update(code_verifier)
    .digest("base64url");

  if (computedChallenge !== authCode.code_challenge) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      { status: 400 }
    );
  }

  // Mark code as consumed (one-time use)
  await supabase
    .from("mcp_auth_codes")
    .update({ consumed: true })
    .eq("code", code);

  // Get or create API key for user
  const userId = authCode.user_id;

  // Check for existing OAuth-issued API key (by source, not name)
  // This ensures manual API keys are never affected by OAuth flows
  const { data: existingKey } = await supabase
    .from("member_api_keys")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "mcp-oauth")  // Only look for OAuth-issued keys
    .single();

  let apiKey: string;

  if (existingKey) {
    // Regenerate only the OAuth key (manual keys remain untouched)
    // This is expected behavior - OAuth tokens are typically regenerated on each auth
    apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    await supabase
      .from("member_api_keys")
      .update({
        key_hash: keyHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingKey.id);
  } else {
    // Create new OAuth-specific API key
    apiKey = generateApiKey();
    const keyHash = hashApiKey(apiKey);

    // Get user's default project
    const { data: membership } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .limit(1)
      .single();

    await supabase.from("member_api_keys").insert({
      user_id: userId,
      project_id: membership?.project_id,
      name: "MCP OAuth Token",
      key_hash: keyHash,
      source: "mcp-oauth",  // Tag the source for future lookups
    });
  }

  // Return token response
  return NextResponse.json({
    access_token: apiKey,
    token_type: "Bearer",
    expires_in: 31536000, // 1 year (API keys don't expire)
    scope: authCode.scope,
  });
}
```

### Context7 MCP Server Updates

#### OAuth Challenge Response

**File:** `packages/mcp/src/lib/oauth.ts`

```typescript
import type { Response } from "express";

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || "https://context7.com";

export function sendOAuthChallenge(res: Response): void {
  res.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${AUTH_SERVER_URL}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    error: "unauthorized",
    error_description: "Authentication required",
    authorization_server: AUTH_SERVER_URL,
  });
}
```

#### Updated MCP Endpoint

**File:** `packages/mcp/src/index.ts` (modification)

```typescript
import { sendOAuthChallenge } from "./lib/oauth.js";

// In the HTTP transport setup:
app.all("/mcp", async (req, res) => {
  // Extract API key from headers (existing logic)
  const apiKey = extractApiKey(req);

  // If no API key provided, send OAuth challenge
  if (!apiKey) {
    return sendOAuthChallenge(res);
  }

  // Continue with existing MCP handling...
});

function extractApiKey(req: Request): string | undefined {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check custom headers (existing logic)
  return (
    req.headers["x-api-key"] ||
    req.headers["context7-api-key"] ||
    req.headers["x-context7-api-key"]
  ) as string | undefined;
}
```

---

## Database Schema

### New Tables

```sql
-- ============================================
-- MCP OAuth Clients (Dynamic Registration)
-- ============================================
CREATE TABLE mcp_oauth_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT UNIQUE NOT NULL,
  client_name TEXT,
  client_uri TEXT,
  redirect_uris TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for client lookups
CREATE INDEX idx_mcp_oauth_clients_client_id ON mcp_oauth_clients(client_id);

-- ============================================
-- Authorization Codes (Short-lived)
-- ============================================
CREATE TABLE mcp_auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
  user_id TEXT NOT NULL,  -- Clerk user ID
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,  -- PKCE challenge
  scope TEXT DEFAULT 'mcp:read',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for code validation
CREATE INDEX idx_mcp_auth_codes_code ON mcp_auth_codes(code);
CREATE INDEX idx_mcp_auth_codes_expires ON mcp_auth_codes(expires_at);

-- ============================================
-- Cleanup Function (Optional)
-- ============================================
-- Run periodically to clean up expired codes
CREATE OR REPLACE FUNCTION cleanup_expired_mcp_auth_codes()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM mcp_auth_codes
  WHERE expires_at < NOW() - INTERVAL '1 hour'
     OR consumed = TRUE;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Update existing member_api_keys table
-- ============================================
-- Add 'source' column to differentiate OAuth keys from manual keys
-- This is critical for API key regeneration on OAuth flows:
-- - OAuth flows regenerate only keys with source='mcp-oauth'
-- - Manual keys (source='manual') are never affected by OAuth

ALTER TABLE member_api_keys
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

COMMENT ON COLUMN member_api_keys.source IS
  'Key source: manual (dashboard), mcp-oauth (OAuth flow), api (programmatic)';

-- Index for efficient OAuth key lookups
CREATE INDEX IF NOT EXISTS idx_member_api_keys_source
ON member_api_keys(user_id, source);
```

---

## File Structure

### Context7app (Next.js)

```
context7app/
├── app/
│   ├── .well-known/
│   │   ├── oauth-protected-resource/
│   │   │   └── route.ts          # RFC 9728 metadata
│   │   └── oauth-authorization-server/
│   │       └── route.ts          # RFC 8414 metadata
│   └── api/
│       └── mcp-auth/
│           ├── register/
│           │   └── route.ts      # Client registration
│           ├── authorize/
│           │   └── route.ts      # Authorization endpoint
│           └── token/
│               └── route.ts      # Token exchange
└── lib/
    └── mcp-auth/                 # (Optional) Shared utilities
        ├── validation.ts         # Input validation
        └── types.ts              # Type definitions
```

### Context7 MCP Server

```
packages/mcp/
└── src/
    ├── lib/
    │   ├── oauth.ts              # OAuth challenge response (NEW)
    │   ├── api.ts                # Existing API functions
    │   ├── encryption.ts         # Existing encryption
    │   └── types.ts              # Existing types
    └── index.ts                  # Updated with OAuth challenge
```

---

## Implementation Checklist

### Phase 1: Database Setup
- [ ] Create `mcp_oauth_clients` table in Supabase
- [ ] Create `mcp_auth_codes` table in Supabase
- [ ] Add `source` column to `member_api_keys` (default: 'manual')
- [ ] Add index on `(user_id, source)` for efficient OAuth key lookups
- [ ] Test table creation and indexes

### Phase 2: Discovery Endpoints
- [ ] Implement `/.well-known/oauth-protected-resource`
- [ ] Implement `/.well-known/oauth-authorization-server`
- [ ] Test with `curl` or browser
- [ ] Verify JSON responses are correct

### Phase 3: Client Registration
- [ ] Implement `/api/mcp-auth/register`
- [ ] Add redirect URI validation
- [ ] Test registration with sample client
- [ ] Verify client stored in database

### Phase 4: Authorization Flow
- [ ] Implement `/api/mcp-auth/authorize`
- [ ] Add PKCE validation
- [ ] Integrate with Clerk auth check
- [ ] Test redirect to sign-in when not authenticated
- [ ] Test redirect back with auth code

### Phase 5: Token Exchange
- [ ] Implement `/api/mcp-auth/token`
- [ ] Add PKCE verification
- [ ] Integrate with API key generation
- [ ] Test full token exchange flow
- [ ] Verify API key returned correctly

### Phase 6: MCP Server Updates
- [ ] Add `oauth.ts` with challenge response
- [ ] Update `/mcp` endpoint to return 401
- [ ] Test 401 response includes correct headers
- [ ] Verify existing API key auth still works

### Phase 7: End-to-End Testing
- [ ] Test with Claude Desktop
- [ ] Test with Cursor
- [ ] Test with VS Code + MCP extension
- [ ] Verify token persistence across sessions

### Phase 8: Production Readiness
- [ ] Add rate limiting to OAuth endpoints
- [ ] Add logging for OAuth events
- [ ] Set up monitoring/alerts
- [ ] Update documentation

---

## Alternative: Proactive OAuth Discovery (No 401 Required)

If your MCP server accepts **anonymous requests** (no API key required), the 401 challenge flow won't trigger automatically. Instead, MCP clients can use **proactive discovery** to find OAuth support.

### How It Works

```
┌──────────────┐                              ┌──────────────┐
│  MCP Client  │                              │  Context7app │
│   (Cursor)   │                              │              │
└──────┬───────┘                              └──────┬───────┘
       │                                             │
       │  1. GET /.well-known/oauth-protected-resource
       ├────────────────────────────────────────────►│
       │                                             │
       │  2. { authorization_servers: [...] }        │
       │◄────────────────────────────────────────────┤
       │                                             │
       │  Client discovers OAuth is available        │
       │  Shows "Authorize" button in UI             │
       ├──┐                                          │
       │  │                                          │
       │◄─┘                                          │
       │                                             │
       │  3. User clicks "Authorize"                 │
       │     → OAuth flow begins (Phase 2-4)         │
       │                                             │
```

### Flow Comparison

| Approach | Trigger | Anonymous Support | User Experience |
|----------|---------|-------------------|-----------------|
| **401 Challenge** | Client connects without token | No - returns 401 | Auto-popup on first connect |
| **Proactive Discovery** | Client checks `.well-known` | Yes - works anonymously | User clicks "Authorize" button |

### When to Use Proactive Discovery

Use this approach when:
- Your server accepts anonymous requests (current Context7 behavior)
- You want users to optionally authenticate for additional features
- You don't want to break existing anonymous users

### Implementation

**No changes needed to the MCP server.** Just implement the `.well-known` endpoints in context7app:

1. `/.well-known/oauth-protected-resource` - Already in the plan
2. `/.well-known/oauth-authorization-server` - Already in the plan

MCP clients (Cursor, Claude Code) will:
1. Fetch these endpoints when the server is added
2. Detect that OAuth is available
3. Show an "Authorize" or "Sign in" button in the MCP server listing
4. User clicks when ready → OAuth flow starts
5. After auth, client uses the token for subsequent requests

### Server Behavior

The MCP server accepts both anonymous and authenticated requests:

```typescript
app.all("/mcp", async (req, res) => {
  const apiKey = extractApiKey(req);

  if (apiKey) {
    // Authenticated request - validate and get user context
    const user = await validateApiKey(apiKey);
    if (!user) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    req.user = user;
  }
  // If no apiKey, continue as anonymous (existing behavior)

  // Handle MCP request...
  // Tools can check req.user to provide personalized responses
});
```

### Benefits of This Approach

1. **No breaking changes** - Anonymous users continue working
2. **User-initiated auth** - Users choose when to authenticate
3. **Graceful upgrade** - Same tools work for both anonymous and authenticated users
4. **Simple implementation** - Only need the `.well-known` endpoints

### Optional: Enhanced Features for Authenticated Users

You can provide additional features for authenticated users:

```typescript
// Example: Personalized documentation recommendations
if (req.user) {
  // Return docs based on user's favorite libraries
  const favorites = await getUserFavorites(req.user.id);
  // ...
} else {
  // Return generic results for anonymous users
}
```

---

## References

### Specifications
- [MCP Authorization Spec (2025-03-26)](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [RFC 9728 - OAuth Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8414 - OAuth Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 7591 - OAuth Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 7636 - PKCE](https://datatracker.ietf.org/doc/html/rfc7636)

### Reference Implementations
- [Sentry MCP OAuth](https://github.com/getsentry/sentry-mcp/tree/main/packages/mcp-cloudflare/src/server/oauth) - Production implementation
- [Cloudflare MCP GitHub OAuth Demo](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth) - Complete example
- [Cloudflare Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider) - OAuth 2.1 library

### Articles
- [Auth0: MCP Specs Update June 2025](https://auth0.com/blog/mcp-specs-update-all-about-auth/)
- [Aaron Parecki: OAuth for MCP](https://aaronparecki.com/2025/04/03/15/oauth-for-model-context-protocol)
- [Cloudflare: MCP Authorization Guide](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
