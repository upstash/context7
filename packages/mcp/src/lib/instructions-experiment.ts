import { createHash } from "node:crypto";
import { ALWAYS_LOAD_META, SERVER_INSTRUCTIONS } from "./server-instructions.js";

/**
 * Server-side A/B test of the server instructions on the hosted endpoint.
 *
 * Control gets the instructions from before CTX7-3596 and deferred tools. Treatment gets the
 * current instructions and `alwaysLoad`. A caller keeps one arm across requests, because the
 * arm comes from a salted hash of the API key, or of the client IP for anonymous callers.
 * The hosted server is stateless, so this is what keeps initialize and later requests in the
 * same arm.
 */

export type InstructionsVariant = "control" | "treatment";

/** Instructions before CTX7-3596. Keep this text unchanged while the test runs. */
export const LEGACY_SERVER_INSTRUCTIONS = `Use this server to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.`;

export const DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT = "ctx7-instructions-2026-11";

export interface InstructionsExperimentConfig {
  /** Share of callers in control, 0 to 100. 0 turns the test off. */
  controlPercent: number;
  salt: string;
}

/**
 * Reads `CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT` (integer 0-100) and
 * `CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT`. A missing or invalid percent turns the test off.
 */
export function instructionsExperimentConfig(
  env: Record<string, string | undefined> = process.env
): InstructionsExperimentConfig {
  const raw = env.CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT?.trim();
  const percent = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
  return {
    controlPercent: percent <= 100 ? percent : 0,
    salt: env.CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT?.trim() || DEFAULT_INSTRUCTIONS_EXPERIMENT_SALT,
  };
}

export function instructionsExperimentEnabled(config: InstructionsExperimentConfig): boolean {
  return config.controlPercent > 0;
}

/** Bucket 0-99 from a salted SHA-256 of the caller identity. */
export function instructionsBucket(identity: string, salt: string): number {
  const digest = createHash("sha256").update(`${salt}:${identity}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * The caller's arm, or undefined when the test is off or the caller has no identity.
 * Callers without an arm get the treatment text and are not counted.
 */
export function assignInstructionsVariant(
  identity: { apiKey?: string; clientIp?: string },
  config: InstructionsExperimentConfig
): InstructionsVariant | undefined {
  if (!instructionsExperimentEnabled(config)) return undefined;
  const key = identity.apiKey
    ? `key:${identity.apiKey}`
    : identity.clientIp
      ? `ip:${identity.clientIp}`
      : undefined;
  if (!key) return undefined;
  return instructionsBucket(key, config.salt) < config.controlPercent ? "control" : "treatment";
}

/** Instructions text and tool `_meta` for an arm. No arm means treatment. */
export function instructionsForVariant(variant: InstructionsVariant | undefined): {
  instructions: string;
  toolMeta: typeof ALWAYS_LOAD_META | undefined;
} {
  return variant === "control"
    ? { instructions: LEGACY_SERVER_INSTRUCTIONS, toolMeta: undefined }
    : { instructions: SERVER_INSTRUCTIONS, toolMeta: ALWAYS_LOAD_META };
}
