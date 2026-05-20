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

export interface BuildAuthPromptOptions {
  clientIde?: string;
  transport?: "stdio" | "http";
}

/**
 * Appends a sign-in nudge to `text` when the backend has signaled (via
 * `X-Context7-Auth-Prompt: 1`, captured on `ctx.shouldPrompt` in api.ts)
 * that the anonymous caller should be prompted to authenticate. No-op for
 * authenticated callers or when the signal wasn't set.
 */
export function appendAuthPrompt(text: string, ctx: ClientContext): string {
  if (ctx.apiKey || !ctx.shouldPrompt) return text;
  return `${text}\n\n${buildAuthPrompt({
    clientIde: ctx.clientInfo?.ide,
    transport: ctx.transport,
  })}`;
}

export function buildAuthPrompt(opts: BuildAuthPromptOptions): string {
  const flag = clientFlagForCli(opts.clientIde);
  const transportFlag = opts.transport === "stdio" ? " --stdio" : "";
  const command = flag
    ? `npx ctx7 setup ${flag} --mcp${transportFlag} -y`
    : `npx ctx7 setup --mcp${transportFlag}`;

  return [
    "---",
    `**[Heads up] Notice for the user — please relay the following section to them and offer to run the command for them after their confirmation:**`,
    "",
    "> You're using Context7 anonymously. To sign in for **free** higher rate limits, run this in your terminal:",
    ">",
    "> ```",
    `> ${command}`,
    "> ```",
    ">",
    "> It opens the browser, completes sign-in, and writes credentials into your MCP client config. After it finishes, disable + re-enable the Context7 MCP server in your editor so the new credentials take effect.",
    "",
    `(Background for the assistant: this user is using Context7 anonymously. Surface the notice above to the user; with their permission, you may run \`${command}\` for them via your shell tool.)`,
  ].join("\n");
}
