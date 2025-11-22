import { createCipheriv, randomBytes } from "crypto";

const ENCRYPTION_KEY =
  process.env.CLIENT_IP_ENCRYPTION_KEY ||
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const ALGORITHM = "aes-256-cbc";

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

export function generateHeaders(
  clientIp?: string,
  apiKey?: string,
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (clientIp) {
    headers["mcp-client-ip"] = encryptClientIp(clientIp);
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}
