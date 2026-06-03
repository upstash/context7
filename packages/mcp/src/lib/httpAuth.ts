import { isJWT, validateJWT } from "./jwt.js";

type HeaderValue = string | string[] | undefined;

interface AuthHeaders {
  authorization?: HeaderValue;
  "context7-api-key"?: HeaderValue;
  "x-api-key"?: HeaderValue;
  context7_api_key?: HeaderValue;
  x_api_key?: HeaderValue;
}

type AuthValidationResult = { valid: true; token: string } | { valid: false; error: string };

const AUTHENTICATION_REQUIRED =
  "Authentication required. Please authenticate to use this MCP server.";
const INVALID_TOKEN = "Invalid token. Please re-authenticate.";

export function extractHeaderValue(value: HeaderValue): string | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? value : value[0];
}

export function extractBearerToken(authHeader: HeaderValue): string | undefined {
  const header = extractHeaderValue(authHeader);
  if (!header) return undefined;

  if (header.startsWith("Bearer ")) {
    return header.substring(7).trim();
  }

  return header;
}

export function extractApiKey(headers: AuthHeaders): string | undefined {
  return (
    extractBearerToken(headers.authorization) ||
    extractHeaderValue(headers["context7-api-key"]) ||
    extractHeaderValue(headers["x-api-key"]) ||
    extractHeaderValue(headers.context7_api_key) ||
    extractHeaderValue(headers.x_api_key)
  );
}

async function validateRequiredOAuthToken(
  token: string | undefined
): Promise<AuthValidationResult> {
  if (!token) {
    return { valid: false, error: AUTHENTICATION_REQUIRED };
  }

  if (!isJWT(token)) {
    return { valid: false, error: INVALID_TOKEN };
  }

  const validationResult = await validateJWT(token);
  if (!validationResult.valid) {
    return { valid: false, error: validationResult.error || INVALID_TOKEN };
  }

  return { valid: true, token };
}

export async function validateRequiredOAuthBearerToken(
  authHeader: HeaderValue
): Promise<AuthValidationResult> {
  const header = extractHeaderValue(authHeader);
  if (!header) {
    return { valid: false, error: AUTHENTICATION_REQUIRED };
  }

  if (!header.startsWith("Bearer ")) {
    return { valid: false, error: INVALID_TOKEN };
  }

  return validateRequiredOAuthToken(header.substring(7).trim());
}
