import { isJWT, validateEmaJWT, validateJWT, type JWTValidationResult } from "../jwt.js";

export type HttpAuthPolicy =
  | { kind: "anonymous"; resourceMetadataUrl: string }
  | { kind: "oauth"; resourceMetadataUrl: string }
  | { kind: "ema"; resourceMetadataUrl: string };

export async function validateMcpCredential(
  policy: HttpAuthPolicy,
  credential: string
): Promise<JWTValidationResult> {
  switch (policy.kind) {
    case "anonymous":
      return { valid: true };
    case "oauth":
      return isJWT(credential) ? validateJWT(credential) : { valid: true };
    case "ema":
      return isJWT(credential)
        ? validateEmaJWT(credential)
        : { valid: false, error: "EMA access token required" };
  }
}
