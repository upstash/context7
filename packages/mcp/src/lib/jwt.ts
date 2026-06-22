import * as jose from "jose";
import {
  CLERK_DOMAIN,
  CONTEXT7_API_BASE_URL,
  EMA_ISSUER,
  EMA_JWKS_URL,
  RESOURCE_URL,
} from "./constants.js";

const CLERK_ISSUER = `https://${CLERK_DOMAIN}`;
const clerkJwks = jose.createRemoteJWKSet(new URL(`https://${CLERK_DOMAIN}/.well-known/jwks.json`));

const emaJwks = jose.createRemoteJWKSet(new URL(EMA_JWKS_URL));

const ENTRA_V2_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;

const jwksByTenant = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>();
function entraJwks(tenantId: string) {
  let jwks = jwksByTenant.get(tenantId);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
    jwksByTenant.set(tenantId, jwks);
  }
  return jwks;
}

interface EntraConfig {
  teamspaceId: string;
  tenantId: string;
  requiredScope: string | null;
}

const CONFIG_TTL_MS = 5 * 60 * 1000;
const configByAudience = new Map<string, { value: EntraConfig | null; expiresAt: number }>();

async function fetchEntraConfig(audience: string): Promise<EntraConfig | null> {
  const now = Date.now();
  const cached = configByAudience.get(audience);
  if (cached && cached.expiresAt > now) return cached.value;

  try {
    const res = await fetch(
      `${CONTEXT7_API_BASE_URL}/v2/entra/config/${encodeURIComponent(audience)}`
    );
    if (res.ok) {
      const value = (await res.json()) as EntraConfig;
      configByAudience.set(audience, { value, expiresAt: now + CONFIG_TTL_MS });
      return value;
    }
    if (res.status === 404) {
      // Authoritative "not configured" response — safe to cache the miss so we
      // don't hammer the app on every token verification.
      configByAudience.set(audience, { value: null, expiresAt: now + CONFIG_TTL_MS });
      return null;
    }
  } catch {
    // Network or JSON parse error: transient. Fall through without caching so
    // the next request retries.
  }
  return null;
}

export interface JWTValidationResult {
  valid: boolean;
  error?: string;
}

export function isJWT(token: string): boolean {
  return token.split(".").length === 3;
}

export async function validateJWT(token: string): Promise<JWTValidationResult> {
  try {
    const decoded = jose.decodeJwt(token);
    const iss = typeof decoded.iss === "string" ? decoded.iss : "";

    if (ENTRA_V2_ISSUER_RE.test(iss)) {
      const audience = typeof decoded.aud === "string" ? decoded.aud : "";
      if (!audience) return { valid: false, error: "Missing audience" };

      const config = await fetchEntraConfig(audience);
      if (!config) return { valid: false, error: "Unknown audience" };

      const { payload } = await jose.jwtVerify(token, entraJwks(config.tenantId), {
        issuer: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
        audience,
      });

      if (config.requiredScope) {
        const scopes = String(payload.scp ?? "").split(" ");
        if (!scopes.includes(config.requiredScope)) {
          return { valid: false, error: "Missing required scope" };
        }
      }

      return { valid: true };
    }

    if (iss === EMA_ISSUER) {
      await jose.jwtVerify(token, emaJwks, { issuer: EMA_ISSUER, audience: RESOURCE_URL });
      return { valid: true };
    }

    await jose.jwtVerify(token, clerkJwks, { issuer: CLERK_ISSUER });
    return { valid: true };
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
