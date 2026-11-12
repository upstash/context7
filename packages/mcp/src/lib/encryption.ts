import { createCipheriv, createHmac, randomBytes } from "crypto";
import { isIP } from "node:net";
import { SERVER_VERSION } from "./constants.js";
import type { ClientContext, InstructionsArm } from "./types.js";

export const INSTRUCTIONS_ARM_HEADER = "X-Context7-Instructions-Assertion";

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
 * Seal a short-lived, authenticated assertion for context7app.
 * Format: <tag>:<unix timestamp seconds>:<12-byte nonce hex>:<ciphertext + tag hex>
 * The tag is part of the authenticated data, so one kind of assertion cannot pass as another.
 */
function sealAssertion(
  tag: string,
  plaintext: string,
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
  if (nonce.length !== 12) return null;

  try {
    const timestamp = Math.floor(nowMs / 1000).toString();
    const aad = `${tag}:${timestamp}`;
    const cipher = createCipheriv(ASSERTION_ALGORITHM, key, nonce);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const ciphertextAndTag = Buffer.concat([ciphertext, cipher.getAuthTag()]);
    return `${aad}:${nonce.toString("hex")}:${ciphertextAndTag.toString("hex")}`;
  } catch {
    return null;
  }
}

/** A client-IP assertion (tag `v1`): the app trusts it in place of the proxy's IP. */
export function createClientIpAssertion(
  clientIp: string,
  nowMs = Date.now(),
  nonce = randomBytes(12)
): string | null {
  if (isIP(clientIp) === 0) return null;
  return sealAssertion(ASSERTION_VERSION, clientIp, nowMs, nonce);
}

/** HMAC-SHA256 of a message with the assertion key, or null without a valid key. */
export function assertionKeyHmac(message: string): Buffer | null {
  const key = assertionKey();
  return key ? createHmac("sha256", key).update(message).digest() : null;
}

/** True when assertions can be sealed: the instructions A/B test needs this. */
export function assertionKeyIsConfigured(): boolean {
  return assertionKey() !== null;
}

/**
 * The caller's A/B arm as an assertion (tag `a1`), so the app records only arms the MCP
 * server assigned and never trusts a header a caller set.
 */
export function createInstructionsArmAssertion(
  arm: InstructionsArm,
  nowMs = Date.now()
): string | null {
  return sealAssertion("a1", JSON.stringify(arm), nowMs);
}

/**
 * What each arm of the instructions A/B test gets, as an assertion (tag `p1`), so the admin
 * page can show the prompts the MCP server really serves.
 */
export function createInstructionsDefinitionAssertion(
  definition: object,
  nowMs = Date.now()
): string | null {
  return sealAssertion("p1", JSON.stringify(definition), nowMs);
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
  if (context.plugin) {
    headers["X-Context7-Plugin"] = context.plugin;
  }
  if (context.transport) {
    headers["X-Context7-Transport"] = context.transport;
  }
  if (context.researchPreview) {
    headers["X-Context7-Research-Preview"] = "1";
  }
  if (context.instructionsArm) {
    const assertion = createInstructionsArmAssertion(context.instructionsArm);
    if (assertion) headers[INSTRUCTIONS_ARM_HEADER] = assertion;
  }

  return headers;
}
