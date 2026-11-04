import {
  CLIENT_CAPABILITIES_META_KEY,
  acceptedContent,
  inputRequired,
  inputResponse,
  type ClientCapabilities,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { ToolError, type Confirmation } from "./tools.js";

/**
 * Confirmation of a destructive change, asked of the user rather than the model.
 *
 * Upstash's agent eval (upstash/upstash-mcp-evals, 2026-10) found that a
 * `confirm` argument does not stop strong models: they fill it in from the
 * user's request without asking. So:
 *
 * - When the client declares form elicitation on a 2026-07-28 request, the
 *   call answers `input_required` with a form where the user types the name.
 *   The client shows it to the user, not the model, and retries with the
 *   answer. The agent's `confirm` is ignored.
 * - Otherwise the call needs `confirm`, which the model could fill on its own.
 *
 * 2025-era elicitation (`elicitInput` over SSE) is not used: this server is
 * stateless, so the answer could reach an instance that never asked.
 */
const KEY = "confirm";
const typed = z.object({ answer: z.string() });

/** The `confirm` argument of every tool with a destructive action (server.ts adds it). */
export const confirmArg = z
  .string()
  .optional()
  .describe(
    "Only for remove and delete actions: the exact target the error asks for, after the user confirms. The user's request is not a confirmation: ask a yes/no question and wait for the answer. Never fill it in on your own."
  );

/** Whether this request's client declared form elicitation (2026-07-28 per-request envelope). */
function canElicit(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as
    Record<string, ClientCapabilities | undefined> | undefined;
  const elicitation = envelope?.[CLIENT_CAPABILITIES_META_KEY]?.elicitation;
  // An empty `elicitation: {}` means form mode (the spec's back-compat rule).
  return (
    elicitation !== undefined && (elicitation.form !== undefined || elicitation.url === undefined)
  );
}

/**
 * Returns the form to show the user, or nothing when the change may go ahead.
 * Throws a ToolError when it may not. `given` is the agent's `confirm` argument.
 */
export function confirmWithUser(
  ctx: ServerContext,
  { action, what, expected, normalize = (value) => value }: Confirmation,
  given: string | undefined
): InputRequiredResult | undefined {
  if (!expected) throw new ToolError(`Nothing was changed: ${what} is empty.`);
  const matches = (answer: string | undefined) =>
    answer !== undefined && normalize(answer.trim()) === expected;
  const askAgain = `Ask the user whether they still want this; if they do, call again so they can confirm.`;

  if (!canElicit(ctx)) {
    if (matches(given)) return undefined;
    const problem =
      given === undefined
        ? "this change needs the user's confirmation"
        : `\`confirm\` does not match ${what}`;
    const next = `Ask the user to confirm. Only after they agree, call again with \`confirm\` set to ${what}.`;
    throw new ToolError(`Not done: ${problem}. ${next}`);
  }

  const responses = ctx.mcpReq.inputResponses;
  const answer = inputResponse(responses, KEY);
  if (answer.kind === "missing") {
    return inputRequired({
      inputRequests: {
        [KEY]: inputRequired.elicit({
          message: `${action}? Type ${what} to confirm: ${expected}`,
          requestedSchema: {
            type: "object",
            properties: { answer: { type: "string", title: what, description: expected } },
            required: ["answer"],
          },
        }),
      },
    });
  }
  if (matches(acceptedContent(responses, KEY, typed)?.answer)) return undefined;
  if (answer.kind === "elicit" && answer.action === "decline") {
    throw new ToolError("Not done: the user declined.");
  }
  if (answer.kind === "elicit" && answer.action === "accept") {
    throw new ToolError(`Not done: what the user typed is not ${what}. ${askAgain}`);
  }
  // A client that cannot show the form (a headless run) also cancels: the user never saw it.
  throw new ToolError(
    `Not done: the confirmation was cancelled. The user closed it, or the client could not show it, so the user has not agreed. ${askAgain}`
  );
}
