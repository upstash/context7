import { createHash } from "node:crypto";
import { CONTEXT7_API_BASE_URL } from "../constants.js";

export type CredentialValidationResult = "valid" | "invalid" | "unavailable";

const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 5_000;
const VALIDATION_TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 1_000;

interface CacheEntry {
  result: Exclude<CredentialValidationResult, "unavailable">;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<CredentialValidationResult>>();

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cacheResult(key: string, result: CacheEntry["result"]): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }

  cache.set(key, {
    result,
    expiresAt: Date.now() + (result === "valid" ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
}

async function requestCredentialValidation(token: string): Promise<CredentialValidationResult> {
  try {
    const response = await fetch(`${CONTEXT7_API_BASE_URL}/dashboard/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });
    await response.body?.cancel();

    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Validates an opaque credential before the OAuth MCP handler allocates any
 * protocol resources. Only explicit backend approval authenticates a caller.
 */
export async function validateOpaqueCredential(token: string): Promise<CredentialValidationResult> {
  const key = tokenHash(token);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) cache.delete(key);

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const validation = requestCredentialValidation(token).then((result) => {
    pending.delete(key);
    if (result !== "unavailable") cacheResult(key, result);
    return result;
  });
  pending.set(key, validation);
  return validation;
}
