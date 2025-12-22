import * as jose from "jose";

// Clerk is the OAuth token issuer
const CLERK_DOMAIN = process.env.CLERK_DOMAIN || "clerk.context7.com";
const JWKS_URL = `https://${CLERK_DOMAIN}/.well-known/jwks.json`;
const ISSUER = `https://${CLERK_DOMAIN}`;

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
      issuer: ISSUER,
    });

    return {
      valid: true,
      userId: payload.sub,
      clientId: (payload.azp as string) || (payload.client_id as string),
      scope: (payload.scope as string) || "",
    };
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
