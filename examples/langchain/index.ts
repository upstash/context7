import "dotenv/config";

import { ChatOpenAI } from "@langchain/openai";
import { Context7 } from "@upstash/context7-sdk";
import { createAgent, tool } from "langchain";
import { z } from "zod";

const context7 = new Context7();

const resolveLibrary = tool(
  ({ libraryName, query }) => context7.searchLibrary(query, libraryName, { type: "txt" }),
  {
    name: "resolve_library",
    description:
      "Find the Context7 library ID for a package. Call this before query_docs unless the user provides an exact Context7 ID such as /vercel/next.js.",
    schema: z.object({
      libraryName: z.string().describe("The official library or package name"),
      query: z.string().describe("The specific documentation question to rank matches for"),
    }),
  }
);

const queryDocs = tool(
  ({ libraryId, query }) => context7.getContext(query, libraryId, { type: "txt" }),
  {
    name: "query_docs",
    description: "Get current documentation for an exact Context7 library ID.",
    schema: z.object({
      libraryId: z.string().describe("An exact Context7 library ID returned by resolve_library"),
      query: z.string().describe("A specific question about one library concept"),
    }),
  }
);

const agent = createAgent({
  model: new ChatOpenAI({ model: "gpt-5-mini" }),
  systemPrompt:
    "You are a coding agent. Use Context7 before answering questions about libraries and base your answer on the retrieved documentation.",
  tools: [resolveLibrary, queryDocs],
});

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "How do I revalidate a route in the latest Next.js?",
    },
  ],
});

console.log(result.messages.at(-1)?.content);
