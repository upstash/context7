import { createHash } from "node:crypto";
import { isIP } from "node:net";
import * as jose from "jose";
import { ALWAYS_LOAD_META, CONTEXT7_API_BASE_URL } from "./constants.js";
import {
  assertionKeyHmac,
  assertionKeyIsConfigured,
  createClientIpAssertion,
  createInstructionsArmAssertion,
  createInstructionsDefinitionAssertion,
  INSTRUCTIONS_ARM_HEADER,
} from "./encryption.js";
import { findJsonRpcMessage } from "./json-rpc.js";
import { isJWT } from "./jwt.js";
import { SERVER_INSTRUCTIONS } from "./server-instructions.js";
import { recordInstructionRequest } from "./telemetry-runtime.js";
import type { InstructionsArm, InstructionsVariant } from "./types.js";
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

/**
 * The test's settings. context7app keeps them in Redis (set on /admin/prompt-experiments) and
 * the hosted server reads them once at startup, so a change needs only a pod restart.
 * - With an experiment ID: `controlPercent` of callers get control, the rest treatment, and
 *   each caller's arm is sealed for the app to count (0 and 100 are allowed).
 * - Without one: everyone gets the same text, uncounted: control at 100, treatment at 0.
 */
export interface InstructionsExperimentConfig {
  experimentId: string | null;
  controlPercent: number;
}

const EXPERIMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The config the app sent, or undefined when it is not valid. */
export function parseInstructionsExperimentConfig(
  value: unknown
): InstructionsExperimentConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { experimentId, controlPercent } = value as Record<string, unknown>;
  if (!Number.isInteger(controlPercent)) return undefined;
  const percent = controlPercent as number;
  if (percent < 0 || percent > 100) return undefined;
  if (experimentId === null) {
    return percent === 0 || percent === 100
      ? { experimentId: null, controlPercent: percent }
      : undefined;
  }
  return typeof experimentId === "string" && EXPERIMENT_ID_PATTERN.test(experimentId)
    ? { experimentId, controlPercent: percent }
    : undefined;
}

/** Everyone gets the production instructions: what a pod serves when it cannot read the config. */
export const PRODUCTION_ONLY: InstructionsExperimentConfig = {
  experimentId: null,
  controlPercent: 100,
};

const CONFIG_ATTEMPTS = 3;
const CONFIG_TIMEOUT_MS = 5_000;

/** Reads the config from context7app, with retries; undefined when it cannot. */
export async function fetchInstructionsExperimentConfig(
  options: { attempts?: number; retryDelayMs?: number } = {}
): Promise<InstructionsExperimentConfig | undefined> {
  const attempts = options.attempts ?? CONFIG_ATTEMPTS;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(`${CONTEXT7_API_BASE_URL}/v2/mcp/instructions-experiment`, {
        headers: { "X-Context7-Source": "mcp-server" },
        signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
      });
      // 404: no experiment is configured, which is an answer, not an error to retry.
      if (response.status === 404) return undefined;
      if (response.ok) return parseInstructionsExperimentConfig(await response.json());
    } catch {
      // Retry below.
    }
    if (attempt < attempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, (options.retryDelayMs ?? 1_000) * attempt)
      );
    }
  }
  return undefined;
}

/**
 * The hosted server's test, from `CONTEXT7_INSTRUCTIONS_EXPERIMENT=remote`. Without that
 * variable (stdio, self-hosted servers) there is no test and everyone gets the current text.
 * With it, the server reads the config from the app once. When the app has none, sends an
 * invalid one, or cannot be reached, everyone gets the production text, so a failure never
 * rolls the new text out. The arms need `MCP_CLIENT_IP_ASSERTION_KEY`: without it this throws,
 * so the deploy fails instead.
 */
export async function loadInstructionsExperiment(
  env: Record<string, string | undefined> = process.env,
  options: {
    fetchConfig?: () => Promise<InstructionsExperimentConfig | undefined>;
    canSealAssertions?: () => boolean;
  } = {}
): Promise<InstructionsExperiment> {
  const mode = env.CONTEXT7_INSTRUCTIONS_EXPERIMENT?.trim();
  if (!mode) return createInstructionsExperiment(undefined);
  if (mode !== "remote") {
    throw new Error(
      `Instructions A/B test: CONTEXT7_INSTRUCTIONS_EXPERIMENT must be "remote", got "${mode}"`
    );
  }
  if (!(options.canSealAssertions ?? assertionKeyIsConfigured)()) {
    throw new Error(
      "Instructions A/B test: MCP_CLIENT_IP_ASSERTION_KEY must be set so context7app can verify the arms"
    );
  }
  const config = await (options.fetchConfig ?? fetchInstructionsExperimentConfig)();
  if (!config) {
    console.error(
      "Instructions A/B test: no valid config from context7app; serving the production instructions"
    );
  }
  return createInstructionsExperiment(config ?? PRODUCTION_ONLY);
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
  // The name comes from the caller: a header must be printable ASCII, or fetch rejects it.
  const client = clientName
    ?.replace(/[^\x20-\x7e]/g, "")
    .trim()
    .slice(0, 100);
  if (client) headers["X-Context7-Client-IDE"] = client;
  void fetch(`${CONTEXT7_API_BASE_URL}/v2/mcp/instructions-exposure`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(EXPOSURE_TIMEOUT_MS),
  }).catch(() => {
    // Exposure reporting is best effort; a missing exposure only lowers the counts.
  });
};

/** What each arm gets, for the admin page in context7app. */
export interface InstructionsExperimentDefinition {
  experimentId: string;
  controlPercent: number;
  arms: Record<InstructionsVariant, { instructions: string; alwaysLoad: boolean }>;
}

/** Sends the definition to context7app; resolves true once the app has stored it. */
export type DefinitionReporter = (definition: InstructionsExperimentDefinition) => Promise<boolean>;

/** Posts the sealed definition to /v2/mcp/instructions-experiment. */
export const reportDefinition: DefinitionReporter = async (definition) => {
  const assertion = createInstructionsDefinitionAssertion(definition);
  if (!assertion) return false;
  try {
    const response = await fetch(`${CONTEXT7_API_BASE_URL}/v2/mcp/instructions-experiment`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Context7-Source": "mcp-server" },
      body: assertion,
      signal: AbortSignal.timeout(EXPOSURE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** Wait between attempts when the app did not store the definition. */
const DEFINITION_RETRY_MS = 60_000;

const INSTRUCTION_METHODS = ["initialize", "server/discover"];

const armSession = (variant: InstructionsVariant | undefined) =>
  variant === "control"
    ? { instructions: LEGACY_SERVER_INSTRUCTIONS, toolMeta: undefined }
    : { instructions: SERVER_INSTRUCTIONS, toolMeta: ALWAYS_LOAD_META };

/**
 * The test for one process. Undefined config: no test, everyone gets the current text.
 */
export function createInstructionsExperiment(
  config: InstructionsExperimentConfig | undefined,
  options: {
    report?: ExposureReporter;
    reportDefinition?: DefinitionReporter;
    now?: () => number;
    hmac?: (message: string) => Buffer | null;
  } = {}
): InstructionsExperiment {
  const experimentId = config?.experimentId ?? null;
  const controlPercent = config?.controlPercent ?? 0;
  // Without an experiment ID nobody gets an arm: the share picks the one text everyone gets.
  const defaultVariant: InstructionsVariant = controlPercent === 100 ? "control" : "treatment";
  const hmac = options.hmac ?? assertionKeyHmac;
  const report = options.report ?? reportExposure;
  const sendDefinition = options.reportDefinition ?? reportDefinition;
  const now = options.now ?? Date.now;
  // The definition goes once per process, with the first exposure; a failure retries later.
  let definition: "unsent" | "sending" | "sent" = "unsent";
  let lastAttempt = -Infinity;
  const ensureDefinition = () => {
    if (!experimentId || definition !== "unsent" || now() - lastAttempt < DEFINITION_RETRY_MS)
      return;
    definition = "sending";
    lastAttempt = now();
    const arm = (variant: InstructionsVariant) => {
      const session = armSession(variant);
      return { instructions: session.instructions, alwaysLoad: session.toolMeta !== undefined };
    };
    void sendDefinition({
      experimentId,
      controlPercent,
      arms: { control: arm("control"), treatment: arm("treatment") },
    })
      .catch(() => false)
      .then((stored) => {
        definition = stored ? "sent" : "unsent";
      });
  };
  return {
    assign(identity) {
      const key = experimentId ? instructionsExperimentIdentity(identity) : undefined;
      // Keyed with the secret assertion key, so a caller cannot work out or pick its arm, and
      // with the experiment ID, so each experiment is a new split.
      const digest = key ? hmac(`${experimentId}:${key}`) : null;
      if (!experimentId || !key || !digest) return undefined;
      return {
        experimentId,
        variant: digest.readUInt32BE(0) % 100 < controlPercent ? "control" : "treatment",
        // Other bytes of the same digest: stable per caller, not reversible.
        unit: digest.toString("hex", 4, 20),
        controlPercent,
        // Only an API key or a user ID keeps a caller in one arm for good. An IP network or an
        // opaque token can change between initialize and later calls, so the app reports
        // those callers apart and does not use them for the main result.
        signedIn: key.startsWith("key:") || key.startsWith("user:"),
      };
    },
    sessionConfig(arm) {
      // Lists differ by arm only while callers get arms.
      return { ...armSession(arm?.variant ?? defaultVariant), privateLists: experimentId !== null };
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
      ensureDefinition();
      report({ arm, clientName, clientIp });
    },
  };
}
