import * as jose from "jose";
import {
  CONTEXT7_API_BASE_URL,
  EMA_ISSUER,
  EMA_JWKS_URL,
  OAUTH_AUTH_SERVER_URL,
  OAUTH_JWKS_URL,
  RESOURCE_URL,
} from "./constants.js";
import { checkOAuthAudience } from "./oauth-audience.js";
import { isVercelMarketplaceIssuer, validateVercelMarketplaceJwt } from "./vercelMarketplaceJwt.js";

const oauthJwks = jose.createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

const emaJwks = jose.createRemoteJWKSet(new URL(EMA_JWKS_URL));

const ENTRA_V2_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;

/** RFC 9068 media type of a JWT OAuth access token. */
const OAUTH_ACCESS_TOKEN_TYP = "at+jwt";
/** Allowed skew between Clerk's clock and ours when checking `exp`/`nbf`. */
const OAUTH_CLOCK_TOLERANCE_SECONDS = 60;

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
  /**
   * A finding about an otherwise verified token that the caller should log,
   * for example an audience mismatch that `observe` mode let through. It
   * names the OAuth client and the audience, never the token.
   */
  warning?: string;
}

export function isJWT(token: string): boolean {
  return token.split(".").length === 3;
}

/** jose compares `typ` the same way: case-insensitive, `application/` prefix optional. */
function normalizeTyp(typ: string): string {
  return typ.toLowerCase().replace(/^application\//, "");
}

/**
 * Whether the token looks like an OAuth access token minted by Clerk: three
 * segments, a `typ` header of `at+jwt` (or `application/at+jwt`), and the
 * configured authorization server as its unsigned `iss`. This only routes the
 * token to the Clerk branch and classifies it for telemetry; trust comes from
 * `jwtVerify`, which checks the signed header and claims.
 */
export function isClerkOAuthJwt(token: string | undefined): token is string {
  if (typeof token !== "string" || !isJWT(token)) return false;
  try {
    const { typ } = jose.decodeProtectedHeader(token);
    if (typeof typ !== "string" || normalizeTyp(typ) !== OAUTH_ACCESS_TOKEN_TYP) return false;
    return jose.decodeJwt(token).iss === OAUTH_AUTH_SERVER_URL;
  } catch {
    return false;
  }
}

/**
 * Clerk signs ID tokens and session JWTs with the same issuer and JWKS as its
 * OAuth access tokens, so issuer and signature alone cannot tell them apart.
 * Only an access token (`typ: at+jwt`, RFC 9068) is a credential for this
 * resource server: an ID token is addressed to the OAuth client, and a session
 * JWT carries the user's whole browser session, which the user never granted
 * to an MCP client and which names no audience at all. Both are rejected with
 * 401 in every audience-enforcement mode; `observe` only relaxes the `aud`
 * comparison of a genuine access token.
 */
async function validateClerkOAuthJwt(token: string): Promise<JWTValidationResult> {
  if (!isClerkOAuthJwt(token)) {
    return { valid: false, error: "Not an OAuth access token" };
  }

  const { payload } = await jose.jwtVerify(token, oauthJwks, {
    issuer: OAUTH_AUTH_SERVER_URL,
    typ: OAUTH_ACCESS_TOKEN_TYP,
    clockTolerance: OAUTH_CLOCK_TOLERANCE_SECONDS,
  });

  const audience = checkOAuthAudience(payload.aud);
  if (audience.allowed) return { valid: true };

  const clientId =
    typeof payload.client_id === "string" && payload.client_id ? payload.client_id : "unknown";
  const warning = `audienceMismatch clientId=${clientId} aud=${audience.aud} enforcement=${audience.enforcement}`;
  if (audience.enforcement === "required") {
    return { valid: false, error: "Token audience not accepted", warning };
  }
  return { valid: true, warning };
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

    if (isVercelMarketplaceIssuer(iss)) {
      return validateVercelMarketplaceJwt(token, iss);
    }

    if (iss === OAUTH_AUTH_SERVER_URL) {
      return await validateClerkOAuthJwt(token);
    }

    // No trusted issuer claims the token, so no JWKS could verify it; the
    // Clerk branch used to be the fallback and failed on the issuer claim
    // after a key lookup.
    return { valid: false, error: "Untrusted issuer" };
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
