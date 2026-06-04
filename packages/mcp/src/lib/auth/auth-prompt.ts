import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClientContext } from "../types.js";

function clientFlagForCli(ide: string | undefined): string {
  if (!ide) return "";
  const lower = ide.toLowerCase();
  if (lower.includes("cursor")) return "--cursor";
  if (lower.includes("claude")) return "--claude";
  if (lower.includes("codex")) return "--codex";
  if (lower.includes("opencode")) return "--opencode";
  if (lower.includes("gemini")) return "--gemini";
  return "";
}

function buildAuthCommand(
  clientIde: string | undefined,
  transport: "stdio" | "http" | undefined
): string {
  const flag = clientFlagForCli(clientIde);
  const transportFlag = transport === "stdio" ? " --stdio" : "";
  return flag
    ? `npx ctx7 setup ${flag} --mcp${transportFlag} -y`
    : `npx ctx7 setup --mcp${transportFlag}`;
}

function buildElicitMessage(
  clientIde: string | undefined,
  transport: "stdio" | "http" | undefined
): string {
  const command = buildAuthCommand(clientIde, transport);
  return [
    "You're using Context7 anonymously. To unlock free higher rate limits, run this in your terminal:",
    "",
    `    ${command}`,
    "",
    "It opens your browser, signs you in, and writes credentials into your MCP client config.",
    "After it finishes, disable then re-enable the Context7 MCP server in your editor so the new credentials take effect.",
  ].join("\n");
}

// In-memory suppression set, keyed per session (or per client IP / "default"
// when no session id is available). Cleared when the MCP process exits, so
// stdio clients reset on editor reload. For longer-lived suppression, the
// backend's per-IP Redis key would need to track this signal too.
const suppressedSessions = new Set<string>();

function suppressionKey(ctx: ClientContext): string {
  return ctx.sessionId ?? ctx.clientIp ?? "default";
}

// User-facing strings double as enum const values: keeps the schema in the
// simpler `enum: [...]` shape (which clients render more reliably than
// `oneOf` with separate `const`/`title`), and the response surfaces the
// chosen label directly so suppression logic can compare against it.
const CHOICE_RUN_SETUP = "I'll run the command to sign in";
const CHOICE_STAY_ANON = "Continue anonymously with smaller limits";

/**
 * Fires a form-mode elicitation that surfaces a sign-in nudge in the client UI
 * when the backend has signaled (via `X-Context7-Auth-Prompt: 1`, captured on
 * `ctx.shouldPrompt` in api.ts) that the anonymous caller should be prompted
 * to authenticate.
 *
 * The message is delivered out-of-band to the human via the client, not into
 * the tool result the LLM reads, so it does not trip prompt-injection guards.
 *
 * Presents a two-option radio: "I'll run the command to sign in" or "Continue
 * anonymously with smaller limits". Picking the latter (or declining outright)
 * suppresses further nudges for the lifetime of the MCP process. The command
 * itself is shown in the dialog message for the user to copy; the server does
 * not attempt to drive the client to run it.
 *
 * No-op for authenticated callers, when the signal wasn't set, when the
 * client did not advertise the `elicitation` capability, or when the user
 * has already chosen to stay anonymous earlier in the session.
 * Fire-and-forget: never blocks or fails the surrounding tool response.
 */
export function maybeElicitAuthSignIn(server: McpServer, ctx: ClientContext): void {
  if (ctx.apiKey || !ctx.shouldPrompt) return;
  const key = suppressionKey(ctx);
  if (suppressedSessions.has(key)) return;
  if (!server.server.getClientCapabilities()?.elicitation) return;

  void server.server
    .elicitInput({
      message: buildElicitMessage(ctx.clientInfo?.ide, ctx.transport),
      requestedSchema: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "How would you like to continue?",
            enum: [CHOICE_RUN_SETUP, CHOICE_STAY_ANON],
            default: CHOICE_RUN_SETUP,
          },
        },
        required: ["choice"],
      },
    })
    .then((result) => {
      // Suppress for the rest of the session when the user explicitly opts to
      // stay anonymous, or when they dismiss the dialog (decline/cancel) —
      // re-prompting after either signal would be noise.
      if (result.action !== "accept" || result.content?.choice === CHOICE_STAY_ANON) {
        suppressedSessions.add(key);
      }
    })
    .catch(() => {
      // Client may not support elicitation despite the capability flag, or
      // the session may have closed before the user responded. Either way,
      // a missed nudge should never affect the tool result.
    });
}
