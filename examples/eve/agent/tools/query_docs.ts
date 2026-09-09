import { Context7 } from "@upstash/context7-sdk";
import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";

const context7 = () => new Context7();

export default defineTool({
  approval: never(),
  description: "Get current documentation for an exact Context7 library ID.",
  inputSchema: z.object({
    libraryId: z.string().describe("An exact Context7 library ID returned by resolve_library"),
    query: z.string().describe("A specific question about one library concept"),
  }),
  execute: ({ libraryId, query }) => context7().getContext(query, libraryId, { type: "txt" }),
});
