import { createCipheriv, randomBytes } from "crypto";
import { SERVER_VERSION } from "./constants.js";

const DEFAULT_ENCRYPTION_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const ENCRYPTION_KEY = process.env.CLIENT_IP_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
const ALGORITHM = "aes-256-cbc";

if (ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
  console.warn("WARNING: Using default CLIENT_IP_ENCRYPTION_KEY.");
}

function validateEncryptionKey(key: string): boolean {
  // Must be exactly 64 hex characters (32 bytes)
  return /^[0-9a-fA-F]{64}$/.test(key);
}

function encryptClientIp(clientIp: string): string {
  if (!validateEncryptionKey(ENCRYPTION_KEY)) {
    console.error("Invalid encryption key format. Must be 64 hex characters.");
    return clientIp; // Fallback to unencrypted
  }

  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, "hex"), iv);
    let encrypted = cipher.update(clientIp, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("Error encrypting client IP:", error);
    return clientIp; // Fallback to unencrypted
  }
}

export interface ClientContext {
  clientIp?: string;
  apiKey?: string;
  clientInfo?: {
    ide?: string;
    version?: string;
  };
  transport?: "stdio" | "http";
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
    headers["mcp-client-ip"] = encryptClientIp(context.clientIp);
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
