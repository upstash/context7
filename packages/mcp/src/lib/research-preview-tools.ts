import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { submitDocsFeedback } from "./api.js";
import { recordToolCallTelemetry } from "./auth-lifecycle-telemetry.js";
import { SUBMIT_DOCS_FEEDBACK_TOOL } from "./tool-names.js";
import type { ClientContext, DocsFeedback } from "./types.js";

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

Call it once after you used the documentation of a library:
- helpful: true when the docs answered the question.
- helpful: false when they did not, with the issue: 'missing' (the docs do not cover it), 'outdated' (they describe an old version), 'incorrect' (the code or facts are wrong), 'irrelevant' (the results were about something else) or 'other'.
Also call it when the user comments on the documentation, with author 'user' and their words in comment.

Do not include sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code.`,
      inputSchema: z.object({
        libraryId: z
          .string()
          .describe(
            "The Context7-compatible library ID the feedback is about, as passed to 'query-docs' (e.g., '/vercel/next.js')."
          ),
        query: z.string().optional().describe("The 'query-docs' query the feedback is about."),
        helpful: z.boolean().describe("Whether the documentation answered the question."),
        issue: z
          .enum(["missing", "outdated", "incorrect", "irrelevant", "other"])
          .optional()
          .describe("What was wrong. Only when helpful is false."),
        comment: z
          .string()
          .optional()
          .describe(
            "Short details: what was missing or wrong, or what the user said. Up to 1000 characters."
          ),
        author: z
          .enum(["agent", "user"])
          .describe(
            "'agent' for your own judgment of the docs, 'user' when you pass on the user's feedback."
          ),
      }),
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
