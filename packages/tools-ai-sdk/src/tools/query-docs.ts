import { tool } from "ai";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import type { Context7ToolsConfig } from "./types";
import { QUERY_DOCS_DESCRIPTION } from "@prompts";

/**
 * Tool to fetch documentation for a library using its Context7 library ID.
 *
 * Can be called with or without configuration. Uses CONTEXT7_API_KEY environment
 * variable for authentication when no API key is provided.
 *
 * @param config Optional configuration options
 * @returns AI SDK tool for fetching library documentation
 *
 * @example
 * ```typescript
 * import { resolveLibraryId, queryDocs } from '@upstash/context7-tools-ai-sdk';
 * import { generateText, stepCountIs } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibraryId: resolveLibraryId(),
 *     queryDocs: queryDocs(),
 *   },
 *   stopWhen: stepCountIs(5),
 * });
 * ```
 */
export function queryDocs(config: Context7ToolsConfig = {}) {
  const { apiKey } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: QUERY_DOCS_DESCRIPTION,
    inputSchema: z.object({
      libraryId: z
        .string()
        .describe(
          "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v14.3.0-canary.87') retrieved from 'resolveLibraryId' or directly from user query in the format '/org/project' or '/org/project/version'."
        ),
      query: z
        .string()
        .describe(
          "The question or task you need help with. Be specific and include relevant details. Good: 'How to set up authentication with JWT in Express.js' or 'React useEffect cleanup function examples'. Bad: 'auth' or 'hooks'. IMPORTANT: Do not include any sensitive or confidential information such as API keys, passwords, credentials, or personal data in your query."
        ),
    }),
    execute: async ({ libraryId, query }: { libraryId: string; query: string }) => {
      try {
        const client = getClient();
        const documentation = await client.getContext(query, libraryId, { type: "txt" });

        if (!documentation || documentation.length === 0) {
          return `No documentation found for library "${libraryId}". This might have happened because you used an invalid Context7-compatible library ID. Use 'resolveLibraryId' to get a valid ID.`;
        }

        return documentation;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to fetch documentation";
        return `Error fetching documentation for "${libraryId}": ${errorMessage}`;
      }
    },
  });
}
