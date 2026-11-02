import { defineTool } from "eve/tools";
import { z } from "zod";
import { getContext7 } from "../lib/context7.js";

export default defineTool({
  description:
    "Search official, up-to-date documentation for libraries, frameworks, and APIs. " +
    "Returns ranked snippets with their library and source URL.",
  inputSchema: z.object({
    query: z.string().min(1).describe("The question, in plain language"),
    library: z
      .string()
      .optional()
      .describe("A library name or Context7 ID, for example Next.js or /vercel/next.js"),
    version: z.string().optional().describe("A specific release, for example 15.4.0"),
  }),
  label: {
    start: ({ query, library }) =>
      library ? `Search ${library} docs: ${query}` : `Search docs: ${query}`,
  },
  async execute({ query, library, version }, ctx) {
    return getContext7().search(query, {
      libraries: library ? [library] : undefined,
      version: library ? version : undefined,
      type: "txt",
      signal: ctx.abortSignal,
    });
  },
});
