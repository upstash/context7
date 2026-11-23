import * as jose from "jose";
import {
  CONTEXT7_API_BASE_URL,
  EMA_ISSUER,
  EMA_JWKS_URL,
  OAUTH_AUTH_SERVER_URL,
  OAUTH_JWKS_URL,
  RESOURCE_URL,
} from "./constants.js";
import {
  checkOAuthAudience,
  FOREIGN_OAUTH_AUDIENCE_MESSAGE,
  normalizeAudience,
} from "./oauth-audience.js";
import { isVercelMarketplaceIssuer, validateVercelMarketplaceJwt } from "./vercelMarketplaceJwt.js";

const oauthJwks = jose.createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

const emaJwks = jose.createRemoteJWKSet(new URL(EMA_JWKS_URL));

const ENTRA_V2_ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/;

/** RFC 9068 media type of a JWT OAuth access token. */
const OAUTH_ACCESS_TOKEN_TYP = "at+jwt";
/** Allowed skew between Clerk's clock and ours when checking `exp`/`nbf`. */
const OAUTH_CLOCK_TOLERANCE_SECONDS = 60;

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

/**
 * Trusted MCP gateways: a teamspace can register its gateway's MCP URL in the
 * Context7 app, so a token a user's agent obtained through that gateway (its
 * `aud` is the gateway's URL) is accepted. Only the app knows which teamspace
 * the token's user acts on, so this server merely asks whether the audience is
 * registered and, if so, lets the token through for the app to decide.
 */
const GATEWAY_TTL_MS = 60 * 1000;
const GATEWAY_CACHE_MAX = 1000;
const trustedGatewayByAudience = new Map<string, { registered: boolean; expiresAt: number }>();

/** Test hook: forget every cached gateway lookup. */
export function resetTrustedGatewayCache(): void {
  trustedGatewayByAudience.clear();
}

/** `undefined` when the app could not answer; such a miss is not cached. */
async function isTrustedGatewayAudience(audience: string): Promise<boolean | undefined> {
  const now = Date.now();
  const cached = trustedGatewayByAudience.get(audience);
  if (cached) {
    if (cached.expiresAt > now) return cached.registered;
    trustedGatewayByAudience.delete(audience);
  }

  try {
    const res = await fetch(
      `${CONTEXT7_API_BASE_URL}/v2/gateway-audiences/${encodeURIComponent(audience)}`
    );
    if (res.status === 204 || res.status === 404) {
      const registered = res.status === 204;
      if (trustedGatewayByAudience.size >= GATEWAY_CACHE_MAX) {
        trustedGatewayByAudience.delete(trustedGatewayByAudience.keys().next().value!);
      }
      trustedGatewayByAudience.set(audience, { registered, expiresAt: now + GATEWAY_TTL_MS });
      return registered;
    }
  } catch {
    // Network error: transient, so not cached.
  }
  return undefined;
}

async function anyTrustedGatewayAudience(aud: unknown): Promise<boolean> {
  const audiences = (typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeAudience(value))
    .filter(Boolean);
  for (const audience of audiences) {
    if (await isTrustedGatewayAudience(audience)) return true;
  }
  return false;
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

/** The unverified `client_id` claim of a JWT, if it is a non-empty string. */
export function oauthClientId(token: string): string | undefined {
  try {
    const { client_id: clientId } = jose.decodeJwt(token);
    return typeof clientId === "string" && clientId ? clientId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clerk signs ID tokens and session JWTs with the same issuer and JWKS as its
 * OAuth access tokens, so issuer and signature alone cannot tell them apart.
 * Only an access token (`typ: at+jwt`, RFC 9068) is a credential for this
 * resource server: an ID token is addressed to the OAuth client, and a session
 * JWT carries the user's whole browser session, which the user never granted
 * to an MCP client and which names no audience at all. Both are rejected with
 * 401 in every audience-enforcement mode; `observe` and `foreign` only relax
 * the `aud` comparison of a genuine access token.
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

  // The token is genuine; is it ours? A token issued for another resource
  // (or for none) is a foreign MCP server's token until the audience check
  // says otherwise. Whether that rejects it is the enforcement mode's call.
  const clientId =
    typeof payload.client_id === "string" && payload.client_id ? payload.client_id : "unknown";
  const warning = `audienceMismatch clientId=${clientId} aud=${audience.aud} enforcement=${audience.enforcement} outcome=${audience.outcome}`;
  if (audience.outcome === "rejected" && (await anyTrustedGatewayAudience(payload.aud))) {
    // A teamspace's trusted gateway. The Context7 API accepts it only for a
    // user of that teamspace and answers 401 otherwise, so it is not logged
    // as a mismatch here.
    return { valid: true };
  }
  if (audience.outcome === "rejected") {
    // A new token from the same client would be rejected the same way, so
    // "re-authenticate" would only send it in a loop; the message names the
    // way out instead.
    return { valid: false, error: FOREIGN_OAUTH_AUDIENCE_MESSAGE, warning };
  }
  return { valid: true, warning };
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
      // Microsoft's multi-tenant rule: the signed tid must be the issuer's tenant, and the
      // key's {tenantid} template is filled from tid, not from the issuer we just matched.
      if (payload.tid !== entraTenantId) return { valid: false, error: "Invalid token claims" };
      if (!entraKeyMayIssue(protectedHeader.kid, issuer, payload.tid)) {
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
