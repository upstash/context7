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

// User-facing strings double as enum const values: keeps the schema in the
// simpler `enum: [...]` shape, which clients render more reliably than
// `oneOf` with separate `const`/`title`.
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
 * The backend owns how often this fires: it sets the header at most once per
 * MCP session, so the server holds no suppression state — it simply shows the
 * dialog whenever the header is present. The command itself is shown in the
 * dialog message for the user to copy; the server does not attempt to drive
 * the client to run it.
 *
 * No-op for authenticated callers, when the signal wasn't set, or when the
 * client did not advertise the `elicitation` capability. Fire-and-forget:
 * never blocks or fails the surrounding tool response.
 */
export function maybeElicitAuthSignIn(server: McpServer, ctx: ClientContext): void {
  if (ctx.apiKey || !ctx.shouldPrompt) return;
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
    .catch(() => {
      // Client may not support elicitation despite the capability flag, or
      // the session may have closed before the user responded. Either way,
      // a missed nudge should never affect the tool result.
    });
}
