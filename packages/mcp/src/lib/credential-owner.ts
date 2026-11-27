import { createHash } from "node:crypto";
import * as jose from "jose";
import { isClerkOAuthJwt, isJWT } from "./jwt.js";
import { isOpaqueOAuthToken, validatedOpaqueOAuthTokenUserId } from "./oauth-token-validation.js";

/** The sha256 hex the app stores for an API key (`hashApiKey`). */
export function apiKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Who a credential belongs to, found without a network call, for the in-memory snapshots:
 * - a Context7 user: a Clerk OAuth JWT's `sub` (the request got here only after
 *   `evaluateMcpAuthentication` verified it; `jwtAudience` is its `aud`), or an opaque token's
 *   user from its cached auth check;
 * - an API key, by the hash the app stores.
 * Other JWTs (Entra, Vercel Marketplace) name no owner here.
 */
export type CredentialOwner = { userId: string; jwtAudience?: unknown } | { apiKeyHash: string };

export function credentialOwner(credential: string): CredentialOwner | undefined {
  if (isOpaqueOAuthToken(credential)) {
    const userId = validatedOpaqueOAuthTokenUserId(credential);
    return userId === undefined ? undefined : { userId };
  }
  if (isClerkOAuthJwt(credential)) {
    const { sub, aud } = jose.decodeJwt(credential);
    return typeof sub === "string" ? { userId: sub, jwtAudience: aud } : undefined;
  }
  if (isJWT(credential)) return undefined;
  return { apiKeyHash: apiKeyHash(credential) };
}
