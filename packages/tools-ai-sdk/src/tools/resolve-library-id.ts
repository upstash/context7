import { tool } from "ai";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import { RESOLVE_LIBRARY_ID_DESCRIPTION } from "@prompts";
import type { Context7ToolsConfig } from "./types";

/**
 * Tool to resolve a library name to a Context7-compatible library ID.
 *
 * Can be called with or without configuration. Uses CONTEXT7_API_KEY environment
 * variable for authentication when no API key is provided.
 *
 * @param config Optional configuration options
 * @returns AI SDK tool for library resolution
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
export function resolveLibraryId(config: Context7ToolsConfig = {}) {
  const { apiKey } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: RESOLVE_LIBRARY_ID_DESCRIPTION,
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "The user's original question or task. This is used to rank library results by relevance to what the user is trying to accomplish. IMPORTANT: Do not include any sensitive or confidential information such as API keys, passwords, credentials, or personal data in your query."
        ),
      libraryName: z
        .string()
        .describe("Library name to search for and retrieve a Context7-compatible library ID."),
    }),
    execute: async ({ query, libraryName }: { query: string; libraryName: string }) => {
      try {
        const client = getClient();
        const results = await client.searchLibrary(query, libraryName, { type: "txt" });

        if (!results || results.length === 0) {
          return `No libraries found matching "${libraryName}". Try a different search term or check the library name.`;
        }

        return results;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to search libraries";
        return `Error searching for libraries: ${errorMessage}. Check your API key and try again.`;
      }
    },
  });
}
