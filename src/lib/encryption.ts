import { createCipheriv, randomBytes } from "crypto";

const DEFAULT_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const ENCRYPTION_KEY = process.env.CLIENT_IP_ENCRYPTION_KEY || DEFAULT_KEY;
const ALGORITHM = "aes-256-cbc";

function validateEncryptionKey(key: string): boolean {
  // Must be exactly 64 hex characters (32 bytes)
  return /^[0-9a-fA-F]{64}$/.test(key);
}

// Warn if using default encryption key
if (ENCRYPTION_KEY === DEFAULT_KEY) {
  console.warn(
    '\n' +
    '⚠️  SECURITY WARNING: Using default encryption key!\n' +
    'Client IP privacy is compromised. Generate a secure key:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    'Set CLIENT_IP_ENCRYPTION_KEY environment variable.\n'
  );
  
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: Default encryption key not allowed in production');
    process.exit(1);
  }
}

function encryptClientIp(clientIp: string): string | null {
  if (!validateEncryptionKey(ENCRYPTION_KEY)) {
    console.error("Invalid encryption key format. Must be 64 hex characters.");
    return null; // Don't send unencrypted IP
  }

  try {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, "hex"), iv);
    let encrypted = cipher.update(clientIp, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("Error encrypting client IP:", error);
    return null; // Don't send unencrypted IP
  }
}

export function generateHeaders(
  clientIp?: string,
  apiKey?: string,
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (clientIp) {
    const encryptedIp = encryptClientIp(clientIp);
    if (encryptedIp) {
      headers["mcp-client-ip"] = encryptedIp;
    }
    // If encryption fails, don't send IP at all (fail securely)
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}
