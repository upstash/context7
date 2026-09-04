import "dotenv/config";

import { openai } from "@ai-sdk/openai";
import { Context7 } from "@upstash/context7-sdk";
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";

const context7 = new Context7();

const resolveLibrary = tool({
  description:
    "Find the Context7 library ID for a package. Call this before queryDocs unless the user provides an exact Context7 ID such as /vercel/next.js.",
  inputSchema: z.object({
    libraryName: z.string().describe("The official library or package name"),
    query: z.string().describe("The specific documentation question to rank matches for"),
  }),
  execute: ({ libraryName, query }) => context7.searchLibrary(query, libraryName, { type: "txt" }),
});

const queryDocs = tool({
  description: "Get current documentation for an exact Context7 library ID.",
  inputSchema: z.object({
    libraryId: z.string().describe("An exact Context7 library ID returned by resolveLibrary"),
    query: z.string().describe("A specific question about one library concept"),
  }),
  execute: ({ libraryId, query }) => context7.getContext(query, libraryId, { type: "txt" }),
});

const agent = new ToolLoopAgent({
  model: openai("gpt-5-mini"),
  instructions:
    "You are a coding agent. Use Context7 before answering questions about libraries and base your answer on the retrieved documentation.",
  tools: { resolveLibrary, queryDocs },
  stopWhen: stepCountIs(5),
});

const result = await agent.generate({
  prompt: "How do I revalidate a route in the latest Next.js?",
});

console.log(result.text);
