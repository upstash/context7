import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { submitDocsFeedback } from "./api.js";
import { recordToolCallTelemetry } from "./auth-lifecycle-telemetry.js";
import { QUERY_DOCS_TOOL, SUBMIT_DOCS_FEEDBACK_TOOL } from "./tool-names.js";
import type { ClientContext } from "./types.js";

/** Added to the server instructions with research preview on, so agents remember the feedback tool. */
export const DOCS_FEEDBACK_INSTRUCTIONS = `After you answer a question with documentation from '${QUERY_DOCS_TOOL}', call '${SUBMIT_DOCS_FEEDBACK_TOOL}' once for that library with a score from 0 to 5 and a short comment on the docs. The user turned on this research preview to collect this feedback.`;

const docsFeedbackSchema = z.object({
  libraryId: z
    .string()
    .describe(
      "The Context7-compatible library ID the feedback is about, as passed to 'query-docs' (e.g., '/vercel/next.js')."
    ),
  query: z.string().optional().describe("The 'query-docs' query the feedback is about."),
  score: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe("How well the docs answered the question, from 0 (useless) to 5 (fully)."),
  issue: z
    .enum(["missing", "outdated", "incorrect", "irrelevant", "other"])
    .optional()
    .describe("What was wrong. Only when the score is below 5."),
  comment: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .describe("What was missing, wrong or good, in one or two sentences. Up to 1000 characters."),
});

export type DocsFeedback = z.infer<typeof docsFeedbackSchema>;

/**
 * Experimental tools, registered only with research preview on
 * (`--research-preview`, `CONTEXT7_RESEARCH_PREVIEW=1` or `?research_preview=1`).
 * Add each tool's name to RESEARCH_PREVIEW_TOOL_NAMES.
 */
export function registerResearchPreviewTools(
  server: McpServer,
  getClientContext: (toolCtx: ServerContext) => ClientContext
): void {
  server.registerTool(
    SUBMIT_DOCS_FEEDBACK_TOOL,
    {
      title: "Submit Documentation Feedback",
      description: `Sends feedback on documentation that 'Query Documentation' returned, so Context7 can fix its docs.

Call it once after you used the documentation of a library to answer a question:
- score: how well the docs answered it, from 0 (useless) to 5 (fully answered with correct, current code).
- issue: what was wrong, only when the score is below 5: 'missing' (the docs do not cover it), 'outdated' (they describe an old version), 'incorrect' (the code or facts are wrong), 'irrelevant' (the results were about something else) or 'other'.
- comment: what was missing or wrong, or what was good, in one or two sentences. When the user comments on the documentation, pass on their words.

Do not include sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code.`,
      inputSchema: docsFeedbackSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
    },
    async (feedback: DocsFeedback, toolCtx) => {
      const ctx = getClientContext(toolCtx);
      const response = await submitDocsFeedback(feedback, ctx);
      recordToolCallTelemetry(ctx, response.outcome);
      return {
        content: [{ type: "text" as const, text: response.text }],
        ...(response.outcome === "error" ? { isError: true } : {}),
      };
    }
  );
}
