import { Context7 } from "@upstash/context7-sdk";
import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";

const context7 = () => new Context7();

export default defineTool({
  approval: never(),
  description:
    "Find the Context7 library ID for a package. Call this before query_docs unless the user provides an exact Context7 ID such as /vercel/next.js.",
  inputSchema: z.object({
    libraryName: z.string().describe("The official library or package name"),
    query: z.string().describe("The specific documentation question to rank matches for"),
  }),
  execute: ({ libraryName, query }) =>
    context7().searchLibrary(query, libraryName, { type: "txt" }),
});
