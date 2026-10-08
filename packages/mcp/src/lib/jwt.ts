import * as jose from "jose";
import {
  CONTEXT7_API_BASE_URL,
  EMA_ISSUER,
  EMA_JWKS_URL,
  OAUTH_AUTH_SERVER_URL,
  OAUTH_JWKS_URL,
  RESOURCE_URL,
} from "./constants.js";
import { isVercelMarketplaceIssuer, validateVercelMarketplaceJwt } from "./vercelMarketplaceJwt.js";

const oauthJwks = jose.createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

const emaJwks = jose.createRemoteJWKSet(new URL(EMA_JWKS_URL));

const ENTRA_V2_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/;

// Microsoft's tenant-independent key set. It holds the keys of every tenant-specific set
// plus the personal-account (MSA) keys, so each key's `issuer` limits which tokens it may sign.
// Apps with custom signing keys (claims mapping, `?appid=` key set) are not supported.
const entraJwks = jose.createRemoteJWKSet(
  new URL("https://login.microsoftonline.com/common/discovery/v2.0/keys")
);

function entraKeyMayIssue(kid: string | undefined, issuer: string, tenantId: string): boolean {
  const key = entraJwks.jwks()?.keys.find((k) => k.kid === kid) as { issuer?: unknown } | undefined;
  return typeof key?.issuer === "string" && key.issuer.replace("{tenantid}", tenantId) === issuer;
}

interface EntraConfig {
  teamspaceId: string;
  tenantId: string;
  requiredScope: string | null;
}

const CONFIG_TTL_MS = 5 * 60 * 1000;
const CONFIG_CACHE_MAX = 1000;
const configByAudience = new Map<string, { value: EntraConfig | null; expiresAt: number }>();

function cacheEntraConfig(audience: string, value: EntraConfig | null, now: number) {
  // Evicts the oldest insert (Map order), not the least recently used; enough for a size cap.
  if (configByAudience.size >= CONFIG_CACHE_MAX) {
    configByAudience.delete(configByAudience.keys().next().value!);
  }
  configByAudience.set(audience, { value, expiresAt: now + CONFIG_TTL_MS });
}

async function fetchEntraConfig(audience: string): Promise<EntraConfig | null> {
  const now = Date.now();
  const cached = configByAudience.get(audience);
  if (cached) {
    if (cached.expiresAt > now) return cached.value;
    configByAudience.delete(audience);
  }

  try {
    const res = await fetch(
      `${CONTEXT7_API_BASE_URL}/v2/entra/config/${encodeURIComponent(audience)}`
    );
    if (res.ok) {
      const value = (await res.json()) as EntraConfig;
      cacheEntraConfig(audience, value, now);
      return value;
    }
    if (res.status === 404) {
      // Authoritative "not configured" response — safe to cache the miss so we
      // don't hammer the app on every token verification.
      cacheEntraConfig(audience, null, now);
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

    const entraTenantId = ENTRA_V2_ISSUER_RE.exec(iss)?.[1];
    if (entraTenantId) {
      const audience = typeof decoded.aud === "string" ? decoded.aud : "";
      if (!audience) return { valid: false, error: "Missing audience" };

      // The claims are untrusted until Microsoft's signature is verified, so no backend lookup before it.
      const issuer = `https://login.microsoftonline.com/${entraTenantId}/v2.0`;
      const { payload, protectedHeader } = await jose.jwtVerify(token, entraJwks, {
        issuer,
        audience,
        algorithms: ["RS256"],
      });
      if (!entraKeyMayIssue(protectedHeader.kid, issuer, entraTenantId)) {
        return { valid: false, error: "Invalid signature" };
      }

      const config = await fetchEntraConfig(audience);
      if (!config) return { valid: false, error: "Unknown audience" };
      if (config.tenantId !== entraTenantId) return { valid: false, error: "Invalid token claims" };

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

    if (isVercelMarketplaceIssuer(iss)) {
      return validateVercelMarketplaceJwt(token, iss);
    }

    await jose.jwtVerify(token, oauthJwks, { issuer: OAUTH_AUTH_SERVER_URL });
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
