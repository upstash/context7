import {
  CLIENT_CAPABILITIES_META_KEY,
  acceptedContent,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { ToolError, type ConfirmWithUser } from "./tools.js";

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

/** Thrown to hold the change back; server.ts returns `ask` as the tool's result. */
export class InputNeeded extends Error {
  constructor(readonly ask: InputRequiredResult) {
    super("The user must confirm this change.");
  }
}

/** Whether this request's client declared form elicitation (2026-07-28 per-request envelope). */
function canElicit(ctx: ServerContext): boolean {
  const capabilities = (ctx.mcpReq.envelope as Record<string, unknown> | undefined)?.[
    CLIENT_CAPABILITIES_META_KEY
  ] as { elicitation?: { form?: unknown; url?: unknown } } | undefined;
  const elicitation = capabilities?.elicitation;
  // An empty `elicitation: {}` means form mode (the spec's back-compat rule).
  return (
    Boolean(elicitation) && (elicitation!.form !== undefined || elicitation!.url === undefined)
  );
}

export function confirmWithUser(ctx: ServerContext): ConfirmWithUser {
  return ({ action, what, expected, given, normalize = (value) => value }) => {
    if (!expected) throw new ToolError(`Could not read ${what} from the API. Nothing was changed.`);
    const matches = (answer: string | undefined) =>
      answer !== undefined && normalize(answer.trim()) === expected;
    const askAgain = `Ask the user whether they still want this; if they do, call again so they can confirm.`;

    if (!canElicit(ctx)) {
      if (matches(given)) return;
      throw new ToolError(
        `Not done: ${given === undefined ? "this change needs the user's confirmation" : `\`confirm\` does not match ${what}`}. Ask the user to confirm. Only after they agree, call again with \`confirm\` set to ${what}.`
      );
    }

    const responses = ctx.mcpReq.inputResponses;
    const answer = inputResponse(responses, KEY);
    if (answer.kind === "missing") {
      throw new InputNeeded(
        inputRequired({
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
        })
      );
    }
    if (matches(acceptedContent(responses, KEY, typed)?.answer)) return;
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
  };
}
