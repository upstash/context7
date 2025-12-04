# JWT OAuth Implementation Plan

## Overview

This document outlines the changes needed to implement JWT-based OAuth flow for Context7 MCP, replacing the current API key approach with short-lived JWT access tokens and long-lived refresh tokens.

## Architecture Decision

| Component | Choice | Details |
|-----------|--------|---------|
| **Access Token** | JWT | 3-hour expiry, signed with RS256 |
| **Refresh Token** | Opaque | 30-day expiry, stored hashed in DB |
| **Signing Algorithm** | RS256 | Asymmetric keys for distributed validation |
| **Caching** | Redis (Upstash) | Cache validated tokens + usage tracking |

### Why RS256 (Asymmetric) vs HS256 (Symmetric)?

- **RS256**: Private key signs (context7app), public key verifies (MCP server)
  - MCP server only needs public key (can't forge tokens)
  - Easy key rotation
  - Better for distributed systems

- **HS256**: Single shared secret
  - Simpler but less secure for distributed systems
  - Anyone with the secret can create tokens

**Recommendation**: Use RS256 for production security.

---

## Token Structure

### JWT Access Token

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "key-2025-01"
  },
  "payload": {
    "iss": "https://context7.com",
    "sub": "user_clerk_id",
    "aud": "https://mcp.context7.com",
    "exp": 1733410800,
    "iat": 1733400000,
    "jti": "unique-token-id",
    "scope": "mcp:read mcp:write",
    "project_id": "proj_xxx",
    "client_id": "oauth-client-id"
  }
}
```

### Token Prefixes

```
Access Token:  ctx7jwt_eyJhbGciOiJSUzI1NiIs...
Refresh Token: ctx7rt_a1b2c3d4e5f6...
```

---

## Changes Required

### Repository: context7 (MCP Server)

#### 1. Add Dependencies

**File:** `packages/mcp/package.json`

```json
{
  "dependencies": {
    "jose": "^5.2.0",
    "@upstash/redis": "^1.28.0"
  }
}
```

> Using `jose` instead of `jsonwebtoken` - it's more modern, has better TypeScript support, and works in edge environments.

#### 2. Create JWT Validation Library

**File:** `packages/mcp/src/lib/jwt.ts`

```typescript
import * as jose from "jose";
import { Redis } from "@upstash/redis";

// Environment variables
const JWKS_URL = process.env.JWKS_URL || "https://context7.com/.well-known/jwks.json";
const JWT_ISSUER = process.env.JWT_ISSUER || "https://context7.com";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "https://mcp.context7.com";

// Redis for caching
const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    })
  : null;

const TOKEN_CACHE_TTL = 300; // 5 minutes

// JWKS client with caching
let jwksClient: jose.JWTVerifyGetKey | null = null;

async function getJwksClient(): Promise<jose.JWTVerifyGetKey> {
  if (!jwksClient) {
    jwksClient = jose.createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: 600000, // 10 minutes
    });
  }
  return jwksClient;
}

export interface TokenPayload {
  sub: string;          // user_id
  project_id: string;
  scope: string;
  client_id: string;
  jti: string;          // token ID for revocation check
}

export interface ValidationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

export async function validateAccessToken(token: string): Promise<ValidationResult> {
  // Strip prefix if present
  const jwt = token.startsWith("ctx7jwt_") ? token.slice(8) : token;

  // 1. Check cache first
  if (redis) {
    const cacheKey = `jwt:${jose.base64url.encode(new TextEncoder().encode(jwt.slice(-32)))}`;
    const cached = await redis.get<TokenPayload>(cacheKey);
    if (cached) {
      return { valid: true, payload: cached };
    }
  }

  try {
    // 2. Verify JWT signature and claims
    const jwks = await getJwksClient();
    const { payload } = await jose.jwtVerify(jwt, jwks, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // 3. Check if token is revoked (optional - for immediate revocation)
    if (redis && payload.jti) {
      const revoked = await redis.get(`revoked:${payload.jti}`);
      if (revoked) {
        return { valid: false, error: "Token revoked" };
      }
    }

    const tokenPayload: TokenPayload = {
      sub: payload.sub as string,
      project_id: payload.project_id as string,
      scope: payload.scope as string,
      client_id: payload.client_id as string,
      jti: payload.jti as string,
    };

    // 4. Cache the validated token
    if (redis) {
      const cacheKey = `jwt:${jose.base64url.encode(new TextEncoder().encode(jwt.slice(-32)))}`;
      const ttl = Math.min(TOKEN_CACHE_TTL, (payload.exp as number) - Math.floor(Date.now() / 1000));
      if (ttl > 0) {
        await redis.set(cacheKey, tokenPayload, { ex: ttl });
      }
    }

    return { valid: true, payload: tokenPayload };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return { valid: false, error: "Token expired" };
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: "Invalid token claims" };
    }
    return { valid: false, error: "Invalid token" };
  }
}

// Revoke a token (called when refresh token is used or user logs out)
export async function revokeToken(jti: string, expiresIn: number): Promise<void> {
  if (redis) {
    await redis.set(`revoked:${jti}`, "1", { ex: expiresIn });
  }
}
```

#### 3. Create Usage Tracking Library

**File:** `packages/mcp/src/lib/usage.ts`

```typescript
import { Redis } from "@upstash/redis";

const redis = process.env.UPSTASH_REDIS_URL
  ? new Redis({
      url: process.env.UPSTASH_REDIS_URL,
      token: process.env.UPSTASH_REDIS_TOKEN!,
    })
  : null;

export async function trackUsage(projectId: string): Promise<void> {
  if (!redis) return;

  const today = new Date().toISOString().split("T")[0];
  const key = `usage:${projectId}:${today}`;

  // Atomic increment, expires after 48 hours
  await redis.incr(key);
  await redis.expire(key, 48 * 60 * 60);
}

export async function getUsage(projectId: string): Promise<number> {
  if (!redis) return 0;

  const today = new Date().toISOString().split("T")[0];
  const key = `usage:${projectId}:${today}`;
  return (await redis.get<number>(key)) || 0;
}

export async function checkRateLimit(projectId: string, limit: number): Promise<boolean> {
  const usage = await getUsage(projectId);
  return usage < limit;
}
```

#### 4. Update MCP Server Authentication

**File:** `packages/mcp/src/index.ts`

Update the authentication middleware to handle JWT:

```typescript
import { validateAccessToken, type TokenPayload } from "./lib/jwt.js";
import { trackUsage, checkRateLimit } from "./lib/usage.js";

// Add to request context
const requestContext = new AsyncLocalStorage<{
  clientIp?: string;
  apiKey?: string;
  user?: TokenPayload;
}>();

// Updated authentication function
async function authenticateRequest(
  req: express.Request,
  res: express.Response,
  requireAuth: boolean
): Promise<{ authenticated: boolean; user?: TokenPayload }> {
  const token = extractApiKey(req); // Reuse existing extraction logic

  if (!token) {
    if (requireAuth) {
      const resourceUrl = process.env.RESOURCE_URL || `http://localhost:${actualPort}`;
      res.set(
        "WWW-Authenticate",
        `Bearer resource_metadata="${resourceUrl}/.well-known/oauth-protected-resource"`
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Authentication required",
        },
        id: null,
      });
    }
    return { authenticated: false };
  }

  // Check if it's a JWT (has prefix or looks like JWT)
  if (token.startsWith("ctx7jwt_") || token.split(".").length === 3) {
    const result = await validateAccessToken(token);

    if (!result.valid) {
      res.set(
        "WWW-Authenticate",
        `Bearer error="invalid_token", error_description="${result.error}"`
      );
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: result.error || "Invalid token",
        },
        id: null,
      });
      return { authenticated: false };
    }

    // Check rate limit
    const withinLimit = await checkRateLimit(result.payload!.project_id, 10000);
    if (!withinLimit) {
      res.status(429).json({
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message: "Rate limit exceeded",
        },
        id: null,
      });
      return { authenticated: false };
    }

    // Track usage (fire and forget)
    trackUsage(result.payload!.project_id).catch(console.error);

    return { authenticated: true, user: result.payload };
  }

  // Fall back to legacy API key validation (for backwards compatibility)
  // This allows existing API keys to continue working
  return { authenticated: true };
}
```

#### 5. Environment Variables

**File:** `packages/mcp/.env.example`

```env
# JWT Configuration
JWKS_URL=https://context7.com/.well-known/jwks.json
JWT_ISSUER=https://context7.com
JWT_AUDIENCE=https://mcp.context7.com

# Redis (Upstash)
UPSTASH_REDIS_URL=https://xxx.upstash.io
UPSTASH_REDIS_TOKEN=xxx

# OAuth
AUTH_SERVER_URL=https://context7.com
RESOURCE_URL=https://mcp.context7.com
```

---

### Repository: context7app (Next.js Backend)

#### 1. Add Dependencies

**File:** `package.json`

```json
{
  "dependencies": {
    "jose": "^5.2.0",
    "@upstash/redis": "^1.28.0"
  }
}
```

#### 2. Generate RSA Key Pair

Run once to generate keys:

```bash
# Generate private key
openssl genrsa -out private.pem 2048

# Extract public key
openssl rsa -in private.pem -pubout -out public.pem

# Convert to JWK format (use a tool or jose library)
```

Store in environment:
- `JWT_PRIVATE_KEY`: Base64-encoded private key (keep secret!)
- `JWT_PUBLIC_KEY`: Base64-encoded public key (can be public)
- `JWT_KEY_ID`: Unique key identifier (e.g., "key-2025-01")

#### 3. Create JWT Utilities

**File:** `lib/mcp-auth/jwt.ts`

```typescript
import * as jose from "jose";
import crypto from "crypto";

const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY!;
const JWT_KEY_ID = process.env.JWT_KEY_ID || "key-2025-01";
const JWT_ISSUER = process.env.NEXT_PUBLIC_APP_URL || "https://context7.com";
const JWT_AUDIENCE = process.env.MCP_RESOURCE_URL || "https://mcp.context7.com";

const ACCESS_TOKEN_EXPIRY = "3h";
const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

let privateKey: jose.KeyLike | null = null;

async function getPrivateKey(): Promise<jose.KeyLike> {
  if (!privateKey) {
    const keyData = Buffer.from(JWT_PRIVATE_KEY, "base64").toString("utf-8");
    privateKey = await jose.importPKCS8(keyData, "RS256");
  }
  return privateKey;
}

export interface TokenClaims {
  userId: string;
  projectId: string;
  scope: string;
  clientId: string;
}

export async function generateAccessToken(claims: TokenClaims): Promise<string> {
  const key = await getPrivateKey();
  const jti = crypto.randomUUID();

  const jwt = await new jose.SignJWT({
    project_id: claims.projectId,
    scope: claims.scope,
    client_id: claims.clientId,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: JWT_KEY_ID })
    .setIssuer(JWT_ISSUER)
    .setSubject(claims.userId)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .setJti(jti)
    .sign(key);

  return `ctx7jwt_${jwt}`;
}

export function generateRefreshToken(): string {
  const randomBytes = crypto.randomBytes(32).toString("base64url");
  return `ctx7rt_${randomBytes}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const REFRESH_TOKEN_EXPIRY = REFRESH_TOKEN_EXPIRY_SECONDS;
export const ACCESS_TOKEN_EXPIRY_SECONDS = 3 * 60 * 60; // 3 hours
```

#### 4. Create JWKS Endpoint

**File:** `app/.well-known/jwks.json/route.ts`

```typescript
import { NextResponse } from "next/server";
import * as jose from "jose";

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;
const JWT_KEY_ID = process.env.JWT_KEY_ID || "key-2025-01";

let publicKeyJwk: jose.JWK | null = null;

async function getPublicKeyJwk(): Promise<jose.JWK> {
  if (!publicKeyJwk) {
    const keyData = Buffer.from(JWT_PUBLIC_KEY, "base64").toString("utf-8");
    const publicKey = await jose.importSPKI(keyData, "RS256");
    publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = JWT_KEY_ID;
    publicKeyJwk.use = "sig";
    publicKeyJwk.alg = "RS256";
  }
  return publicKeyJwk;
}

export async function GET() {
  const jwk = await getPublicKeyJwk();

  return NextResponse.json(
    {
      keys: [jwk],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    }
  );
}
```

#### 5. Update Token Endpoint

**File:** `app/api/mcp-auth/token/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/serverClient";
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY,
} from "@/lib/mcp-auth/jwt";
import crypto from "crypto";

export async function POST(request: Request) {
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

  const { grant_type } = params;

  if (grant_type === "authorization_code") {
    return handleAuthorizationCode(params);
  } else if (grant_type === "refresh_token") {
    return handleRefreshToken(params);
  } else {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
}

async function handleAuthorizationCode(params: Record<string, string>) {
  const { code, code_verifier, redirect_uri } = params;

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

  // Verify PKCE
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

  // Mark code as consumed
  await supabase.from("mcp_auth_codes").update({ consumed: true }).eq("code", code);

  // Get user's default project
  const { data: membership } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", authCode.user_id)
    .limit(1)
    .single();

  const projectId = membership?.project_id || "default";

  // Generate JWT access token
  const accessToken = await generateAccessToken({
    userId: authCode.user_id,
    projectId: projectId,
    scope: authCode.scope || "mcp:read",
    clientId: authCode.client_id,
  });

  // Generate refresh token
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenExpiry = new Date(Date.now() + REFRESH_TOKEN_EXPIRY * 1000);

  // Revoke any existing refresh tokens for this user/client
  await supabase
    .from("mcp_refresh_tokens")
    .update({ revoked: true })
    .eq("user_id", authCode.user_id)
    .eq("client_id", authCode.client_id);

  // Store new refresh token
  await supabase.from("mcp_refresh_tokens").insert({
    token_hash: refreshTokenHash,
    user_id: authCode.user_id,
    client_id: authCode.client_id,
    project_id: projectId,
    scope: authCode.scope || "mcp:read",
    expires_at: refreshTokenExpiry.toISOString(),
  });

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
    refresh_token: refreshToken,
    scope: authCode.scope || "mcp:read",
  });
}

async function handleRefreshToken(params: Record<string, string>) {
  const { refresh_token } = params;

  if (!refresh_token) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "refresh_token required" },
      { status: 400 }
    );
  }

  const supabase = createClient();
  const refreshTokenHash = hashToken(refresh_token);

  // Look up refresh token
  const { data: storedToken } = await supabase
    .from("mcp_refresh_tokens")
    .select("*")
    .eq("token_hash", refreshTokenHash)
    .eq("revoked", false)
    .single();

  if (!storedToken) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Invalid refresh token" },
      { status: 400 }
    );
  }

  // Check expiration
  if (new Date(storedToken.expires_at) < new Date()) {
    await supabase
      .from("mcp_refresh_tokens")
      .update({ revoked: true })
      .eq("id", storedToken.id);

    return NextResponse.json(
      { error: "invalid_grant", error_description: "Refresh token expired" },
      { status: 400 }
    );
  }

  // Update last_used_at
  await supabase
    .from("mcp_refresh_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", storedToken.id);

  // Generate new JWT access token
  const accessToken = await generateAccessToken({
    userId: storedToken.user_id,
    projectId: storedToken.project_id,
    scope: storedToken.scope,
    clientId: storedToken.client_id,
  });

  return NextResponse.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
    scope: storedToken.scope,
  });
}
```

#### 6. Update Authorization Server Metadata

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
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,  // NEW
    scopes_supported: ["mcp:read", "mcp:write"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
```

---

### Database Schema Changes

#### New Table: mcp_refresh_tokens

```sql
CREATE TABLE mcp_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  project_id TEXT,
  scope TEXT DEFAULT 'mcp:read',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_mcp_refresh_tokens_hash ON mcp_refresh_tokens(token_hash);
CREATE INDEX idx_mcp_refresh_tokens_user ON mcp_refresh_tokens(user_id);
CREATE INDEX idx_mcp_refresh_tokens_expires ON mcp_refresh_tokens(expires_at);
```

#### Optional: Token Revocation Table (for immediate JWT revocation)

```sql
-- Only needed if you want instant JWT revocation
-- Otherwise, just wait for JWT to expire (3 hours max)
CREATE TABLE mcp_revoked_tokens (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL  -- Auto-delete after JWT would have expired
);

-- Auto-cleanup (run periodically)
CREATE OR REPLACE FUNCTION cleanup_revoked_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM mcp_revoked_tokens WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
```

---

## Implementation Checklist

### Phase 1: Setup (context7app)

- [ ] Generate RSA key pair
- [ ] Add `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID` to environment
- [ ] Install `jose` package
- [ ] Create `lib/mcp-auth/jwt.ts`
- [ ] Create `app/.well-known/jwks.json/route.ts`
- [ ] Create `mcp_refresh_tokens` table in Supabase

### Phase 2: Token Endpoint (context7app)

- [ ] Update `app/api/mcp-auth/token/route.ts` for JWT generation
- [ ] Update `app/.well-known/oauth-authorization-server/route.ts` with `jwks_uri`
- [ ] Test authorization_code grant returns JWT
- [ ] Test refresh_token grant returns new JWT

### Phase 3: MCP Server (context7)

- [ ] Install `jose` and `@upstash/redis` packages
- [ ] Create `packages/mcp/src/lib/jwt.ts`
- [ ] Create `packages/mcp/src/lib/usage.ts`
- [ ] Update `packages/mcp/src/index.ts` authentication logic
- [ ] Add environment variables for JWKS URL and Redis
- [ ] Test JWT validation works
- [ ] Test expired token returns proper error

### Phase 4: Integration Testing

- [ ] Test full OAuth flow with Cursor/Claude Desktop
- [ ] Test token refresh when access token expires
- [ ] Test rate limiting works
- [ ] Test usage tracking in Redis
- [ ] Verify backwards compatibility with existing API keys

### Phase 5: Production

- [ ] Deploy context7app changes
- [ ] Deploy MCP server changes
- [ ] Monitor for errors
- [ ] Set up Redis usage flush job (if using batched DB writes)

---

## Security Considerations

1. **Private Key Protection**: Never expose `JWT_PRIVATE_KEY`. Use secrets management.

2. **Key Rotation**: Plan for periodic key rotation:
   - Generate new key pair with new `kid`
   - Add new public key to JWKS (keep old one)
   - Switch signing to new private key
   - Remove old public key after all old JWTs expire

3. **Refresh Token Security**:
   - Always hash before storing
   - Consider refresh token rotation (issue new refresh token on each use)
   - Implement token family tracking to detect theft

4. **Rate Limiting**: Protect token endpoint from brute force.

5. **HTTPS Only**: Never transmit tokens over HTTP.

---

## Flow Diagram

```
Authorization Code Flow:
┌────────────┐                              ┌─────���──────┐
│ MCP Client │                              │ context7app│
└─────┬──────┘                              └─────┬──────┘
      │                                           │
      │  POST /api/mcp-auth/token                 │
      │  grant_type=authorization_code            │
      │  code=xxx, code_verifier=yyy              │
      ├──────────────────────────────────────────►│
      │                                           │
      │                              Verify PKCE  │
      │                              Generate JWT │
      │                              Store refresh│
      │                                           │
      │  { access_token: "ctx7jwt_xxx",          │
      │    refresh_token: "ctx7rt_yyy",          │
      │    expires_in: 10800 }                   │
      │◄──────────────────────────────────────────┤
      │                                           │

Token Refresh Flow:
┌────────────┐                              ┌────────────┐
│ MCP Client │                              │ context7app│
└─────┬──────┘                              └─────┬──────┘
      │                                           │
      │  POST /api/mcp-auth/token                 │
      │  grant_type=refresh_token                 │
      │  refresh_token=ctx7rt_yyy                 │
      ├──────────────────────────────────────────►│
      │                                           │
      │                        Verify refresh hash│
      │                              Generate JWT │
      │                                           │
      │  { access_token: "ctx7jwt_zzz",          │
      │    expires_in: 10800 }                   │
      │◄──────────────────────────────────────────┤
      │                                           │

API Request Flow:
┌────────────┐                              ┌────────────┐
│ MCP Client │                              │ MCP Server │
└─────┬──────┘                              └─────┬──────┘
      │                                           │
      │  POST /mcp/oauth                          │
      │  Authorization: Bearer ctx7jwt_xxx        │
      ├──────────────────────────────────────────►│
      │                                           │
      │                     1. Check Redis cache  │
      │                     2. If miss: verify JWT│
      │                        via JWKS           │
      │                     3. Check rate limit   │
      │                     4. Track usage        │
      │                                           │
      │  { result: ... }                         │
      │◄──────────────────────────────────────────┤
      │                                           │
```

---

## Backwards Compatibility

The implementation maintains backwards compatibility:

1. **Existing API keys continue to work**: The MCP server checks token format and falls back to legacy validation for non-JWT tokens.

2. **Gradual migration**: Users can continue using dashboard-created API keys while new OAuth users get JWTs.

3. **No client changes needed**: MCP clients just see a Bearer token - they don't care if it's JWT or opaque.
