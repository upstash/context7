import * as jose from "jose";

const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || "https://context7.com";
const JWKS_URL = `${AUTH_SERVER_URL}/.well-known/jwks.json`;

const RESOURCE_URL = (process.env.RESOURCE_URL || "https://mcp.context7.com").replace(/\/$/, "");

// we cache the jwks to avoid fetching it on every request
let jwksCache: jose.JWTVerifyGetKey | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now();
  if (jwksCache && now - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  jwksCache = jose.createRemoteJWKSet(new URL(JWKS_URL));
  jwksCacheTime = now;
  return jwksCache;
}

export interface JWTValidationResult {
  valid: boolean;
  userId?: string;
  clientId?: string;
  scope?: string;
  error?: string;
}

export function isJWT(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3;
}

export async function validateJWT(token: string): Promise<JWTValidationResult> {
  if (!isJWT(token)) {
    return { valid: false, error: "Not a valid JWT format" };
  }

  try {
    const jwks = await getJWKS();
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: AUTH_SERVER_URL,
      audience: RESOURCE_URL,
    });

    const result = {
      valid: true,
      userId: payload.sub,
      clientId: payload.client_id as string,
      scope: payload.scope as string,
    };

    return result;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return { valid: false, error: "Token expired" };
    }
    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: "Invalid token claims" };
    }
    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      return { valid: false, error: "Invalid signature" };
    }
    return { valid: false, error: "Invalid token" };
  }
}
