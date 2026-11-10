import { createHash } from "node:crypto";
import * as jose from "jose";
import { ALWAYS_LOAD_META } from "./constants.js";
import { findJsonRpcMessage } from "./json-rpc.js";
import { isJWT } from "./jwt.js";
import { SERVER_INSTRUCTIONS } from "./server-instructions.js";
import { recordInstructionRequest } from "./telemetry-runtime.js";
import type { InstructionsArm } from "./types.js";
import { envelopeClientInfo } from "./utils.js";

/**
 * Server-side A/B test of the server instructions on the hosted endpoint.
 *
 * Control gets the instructions from before CTX7-3596 and deferred tools. Treatment gets the
 * current instructions and `alwaysLoad`. A caller keeps one arm across requests, because the
 * arm comes from a salted hash of a stable caller identity. The hosted server is stateless,
 * so this is what keeps initialize and later requests in the same arm.
 */

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

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * The stable identity that decides a caller's arm, or undefined without one.
 * - `ctx7sk-` API keys use the same SHA-256 hex that context7app stores, so the app can
 *   recompute each key's arm.
 * - JWT access tokens use their `sub` claim (the user ID), which survives token refresh.
 * - Other tokens use their own hash, so an opaque token can change arms when it rotates.
 * - Anonymous callers use the client IP.
 * The token is not verified here; authentication does that before the request is served.
 */
export function instructionsExperimentIdentity(identity: {
  apiKey?: string;
  clientIp?: string;
}): string | undefined {
  const { apiKey, clientIp } = identity;
  if (apiKey?.startsWith("ctx7sk-")) return `key:${sha256Hex(apiKey)}`;
  if (apiKey && isJWT(apiKey)) {
    try {
      const sub = jose.decodeJwt(apiKey).sub;
      if (sub) return `user:${sub}`;
    } catch {
      // Fall through to the token hash.
    }
  }
  if (apiKey) return `token:${sha256Hex(apiKey)}`;
  return clientIp ? `ip:${clientIp}` : undefined;
}

export interface InstructionsSessionConfig {
  /** Base instructions; research preview may add to them (serverInstructions). */
  instructions: string;
  toolMeta: typeof ALWAYS_LOAD_META | undefined;
  /** Lists that differ by arm (tools/list, server/discover) must not share a cache. */
  privateLists: boolean;
}

export interface InstructionsExperiment {
  /** The caller's arm, or undefined when the test is off or the caller has no identity. */
  assign(identity: { apiKey?: string; clientIp?: string }): InstructionsArm | undefined;
  /** What a session gets. Callers without an arm get the treatment text. */
  sessionConfig(arm: InstructionsArm | undefined): InstructionsSessionConfig;
  /** Counts a request body that asks for the instructions (initialize or server/discover). */
  observeRequest(arm: InstructionsArm | undefined, body: unknown, fallbackClient?: string): void;
}

const INSTRUCTION_METHODS = ["initialize", "server/discover"];

/** The test for one process. Pass an empty env (stdio) to keep it off. */
export function createInstructionsExperiment(
  env: Record<string, string | undefined> = process.env
): InstructionsExperiment {
  const { controlPercent, salt } = instructionsExperimentConfig(env);
  const running = controlPercent > 0;
  return {
    assign(identity) {
      const key = running ? instructionsExperimentIdentity(identity) : undefined;
      if (!key) return undefined;
      const digest = createHash("sha256").update(`${salt}:${key}`).digest();
      return {
        variant: digest.readUInt32BE(0) % 100 < controlPercent ? "control" : "treatment",
        // Other bytes of the same salted digest: stable per caller, not reversible.
        unit: digest.toString("hex", 4, 20),
        controlPercent,
      };
    },
    sessionConfig(arm) {
      const control = arm?.variant === "control";
      return {
        instructions: control ? LEGACY_SERVER_INSTRUCTIONS : SERVER_INSTRUCTIONS,
        toolMeta: control ? undefined : ALWAYS_LOAD_META,
        privateLists: running,
      };
    },
    observeRequest(arm, body, fallbackClient) {
      if (!arm) return;
      const message = findJsonRpcMessage(body, INSTRUCTION_METHODS);
      if (!message) return;
      // Legacy initialize sends clientInfo; modern requests send it in the _meta envelope.
      const name = (message.params?.clientInfo as { name?: unknown } | undefined)?.name;
      recordInstructionRequest(
        arm.variant,
        (typeof name === "string" ? name : envelopeClientInfo(message.params?._meta)?.ide) ??
          fallbackClient
      );
    },
  };
}
