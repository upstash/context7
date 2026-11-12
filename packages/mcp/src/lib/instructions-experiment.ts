import { createHash } from "node:crypto";
import { isIP } from "node:net";
import * as jose from "jose";
import { ALWAYS_LOAD_META, CONTEXT7_API_BASE_URL } from "./constants.js";
import {
  assertionKeyIsConfigured,
  createClientIpAssertion,
  createInstructionsArmAssertion,
  INSTRUCTIONS_ARM_HEADER,
} from "./encryption.js";
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

export interface InstructionsExperimentConfig {
  /** Share of callers in control, 1 to 100. Undefined when the test is off. */
  controlPercent: number;
  experimentId: string;
  salt: string;
}

/**
 * Reads the test settings. `CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT` unset, empty or 0 turns the
 * test off (everyone gets the current instructions). Any other value must be an integer
 * 1-100 and needs `CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID`, a secret
 * `CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT` (16+ characters), and a valid
 * `MCP_CLIENT_IP_ASSERTION_KEY`; otherwise this throws, so a typo fails the deploy instead of
 * silently rolling the new instructions out to everyone. Roll back with 100 (all control).
 */
export function instructionsExperimentConfig(
  env: Record<string, string | undefined> = process.env,
  canSealAssertions = assertionKeyIsConfigured
): InstructionsExperimentConfig | undefined {
  const raw = env.CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT?.trim();
  if (!raw || raw === "0") return undefined;
  const fail = (message: string): never => {
    throw new Error(`Instructions A/B test: ${message}`);
  };
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
    fail(`CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT must be an integer 0-100, got "${raw}"`);
  }
  const experimentId = env.CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(experimentId)) {
    fail("CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID must be 1-40 lowercase letters, digits or dashes");
  }
  const salt = env.CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT?.trim() ?? "";
  if (salt.length < 16)
    fail("CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT must be a secret of 16+ characters");
  if (!canSealAssertions()) {
    fail("MCP_CLIENT_IP_ASSERTION_KEY must be set so context7app can verify the arms");
  }
  return { controlPercent: Number(raw), experimentId, salt };
}

/**
 * The caller's network: an IPv4 address, or the /64 of an IPv6 address, whose host part
 * changes often (privacy addresses) while the user stays the same.
 */
export function anonymousNetwork(clientIp: string): string {
  const ip = clientIp.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (isIP(ip) !== 6) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...headGroups, ...Array(8 - headGroups.length - tailGroups.length).fill("0"), ...tailGroups]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * The stable identity that decides a caller's arm, or undefined without one.
 * - `ctx7sk-` API keys use the same SHA-256 hex that context7app stores, so the app can
 *   recompute each key's arm.
 * - JWT access tokens use their `sub` claim (the user ID), which survives token refresh.
 * - Other tokens use their own hash, so an opaque token can change arms when it rotates.
 * - Anonymous callers use the client IP, or the /64 of an IPv6 address.
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
  return clientIp ? `ip:${anonymousNetwork(clientIp)}` : undefined;
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
  /**
   * For a request that asks for the instructions (initialize or server/discover): counts it
   * and reports the exposure to context7app, which counts exposed units per arm and client.
   */
  observeRequest(
    request: { arm: InstructionsArm | undefined; clientIp?: string; fallbackClient?: string },
    body: unknown
  ): void;
}

/** Sends one exposure to context7app; never throws and never delays the MCP response. */
export type ExposureReporter = (exposure: {
  arm: InstructionsArm;
  clientName: string | undefined;
  clientIp: string | undefined;
}) => void;

const EXPOSURE_TIMEOUT_MS = 3_000;

/** Posts the exposure to /v2/mcp/instructions-exposure without the caller's credentials. */
export const reportExposure: ExposureReporter = ({ arm, clientName, clientIp }) => {
  const armAssertion = createInstructionsArmAssertion(arm);
  if (!armAssertion) return;
  const headers: Record<string, string> = {
    "X-Context7-Source": "mcp-server",
    [INSTRUCTIONS_ARM_HEADER]: armAssertion,
  };
  const ipAssertion = clientIp && createClientIpAssertion(clientIp);
  if (ipAssertion) headers["mcp-client-ip-assertion"] = ipAssertion;
  if (clientName) headers["X-Context7-Client-IDE"] = clientName;
  void fetch(`${CONTEXT7_API_BASE_URL}/v2/mcp/instructions-exposure`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(EXPOSURE_TIMEOUT_MS),
  }).catch(() => {
    // Exposure reporting is best effort; a missing exposure only lowers the counts.
  });
};

const INSTRUCTION_METHODS = ["initialize", "server/discover"];

/** The test for one process. Pass an empty env (stdio) to keep it off. */
export function createInstructionsExperiment(
  env: Record<string, string | undefined> = process.env,
  options: { report?: ExposureReporter; canSealAssertions?: () => boolean } = {}
): InstructionsExperiment {
  const config = instructionsExperimentConfig(env, options.canSealAssertions);
  const report = options.report ?? reportExposure;
  return {
    assign(identity) {
      const key = config ? instructionsExperimentIdentity(identity) : undefined;
      if (!config || !key) return undefined;
      const digest = createHash("sha256").update(`${config.salt}:${key}`).digest();
      return {
        experimentId: config.experimentId,
        variant: digest.readUInt32BE(0) % 100 < config.controlPercent ? "control" : "treatment",
        // Other bytes of the same salted digest: stable per caller, not reversible.
        unit: digest.toString("hex", 4, 20),
        controlPercent: config.controlPercent,
        signedIn: !key.startsWith("ip:"),
      };
    },
    sessionConfig(arm) {
      const control = arm?.variant === "control";
      return {
        instructions: control ? LEGACY_SERVER_INSTRUCTIONS : SERVER_INSTRUCTIONS,
        toolMeta: control ? undefined : ALWAYS_LOAD_META,
        privateLists: config !== undefined,
      };
    },
    observeRequest({ arm, clientIp, fallbackClient }, body) {
      if (!arm) return;
      const message = findJsonRpcMessage(body, INSTRUCTION_METHODS);
      if (!message) return;
      // Legacy initialize sends clientInfo; modern requests send it in the _meta envelope.
      const name = (message.params?.clientInfo as { name?: unknown } | undefined)?.name;
      const clientName =
        (typeof name === "string" ? name : envelopeClientInfo(message.params?._meta)?.ide) ??
        fallbackClient;
      recordInstructionRequest(arm.variant, clientName);
      report({ arm, clientName, clientIp });
    },
  };
}
