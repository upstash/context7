import { createCipheriv, randomBytes } from "crypto";
import { isIP } from "node:net";
import { SERVER_VERSION } from "./constants.js";
import type { ClientContext } from "./types.js";

const ASSERTION_ALGORITHM = "aes-256-gcm";
const ASSERTION_VERSION = "v1";
let reportedInvalidAssertionKey = false;

function validateEncryptionKey(key: string): boolean {
  // Must be exactly 64 hex characters (32 bytes)
  return /^[0-9a-fA-F]{64}$/.test(key);
}

function assertionKey() {
  const key = process.env.MCP_CLIENT_IP_ASSERTION_KEY;
  return key && validateEncryptionKey(key) ? Buffer.from(key, "hex") : null;
}

/**
 * Create a short-lived, authenticated client-IP assertion.
 * Format: v1:<unix timestamp seconds>:<12-byte nonce hex>:<ciphertext + tag hex>
 */
export function createClientIpAssertion(
  clientIp: string,
  nowMs = Date.now(),
  nonce = randomBytes(12)
): string | null {
  const key = assertionKey();
  if (!key) {
    if (!reportedInvalidAssertionKey) {
      reportedInvalidAssertionKey = true;
      console.error(
        "MCP_CLIENT_IP_ASSERTION_KEY is missing or invalid; client IP assertions are disabled."
      );
    }
    return null;
  }
  if (nonce.length !== 12 || isIP(clientIp) === 0) return null;

  try {
    const timestamp = Math.floor(nowMs / 1000).toString();
    const aad = `${ASSERTION_VERSION}:${timestamp}`;
    const cipher = createCipheriv(ASSERTION_ALGORITHM, key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(clientIp, "utf8"), cipher.final()]);
    const ciphertextAndTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);
    return `${aad}:${nonce.toString("hex")}:${ciphertextAndTag.toString("hex")}`;
  } catch {
    return null;
  }
}

/**
 * Generate headers for Context7 API requests.
 * Handles client IP encryption, authentication, and telemetry headers.
 */
export function generateHeaders(context: ClientContext): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Context7-Source": "mcp-server",
    "X-Context7-Server-Version": SERVER_VERSION,
  };

  if (context.clientIp) {
    const assertion = createClientIpAssertion(context.clientIp);
    if (assertion) headers["mcp-client-ip-assertion"] = assertion;
  }
  if (context.sessionId) {
    headers["mcp-session-id"] = context.sessionId;
  }
  if (context.apiKey) {
    headers["Authorization"] = `Bearer ${context.apiKey}`;
  }
  if (context.clientInfo?.ide) {
    headers["X-Context7-Client-IDE"] = context.clientInfo.ide;
  }
  if (context.clientInfo?.version) {
    headers["X-Context7-Client-Version"] = context.clientInfo.version;
  }
  if (context.transport) {
    headers["X-Context7-Transport"] = context.transport;
  }

  return headers;
}
