import { tool } from "ai";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import { RESOLVE_LIBRARY_DESCRIPTION } from "@prompts";
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
 * import { resolveLibrary, getLibraryDocs } from '@upstash/context7-tools-ai-sdk';
 * import { generateText, stepCountIs } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibrary: resolveLibrary(),
 *     getLibraryDocs: getLibraryDocs(),
 *   },
 *   stopWhen: stepCountIs(5),
 * });
 * ```
 */
export function resolveLibrary(config: Context7ToolsConfig = {}) {
  const { apiKey } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: RESOLVE_LIBRARY_DESCRIPTION,
    inputSchema: z.object({
      libraryName: z
        .string()
        .describe("Library name to search for and retrieve a Context7-compatible library ID."),
    }),
    execute: async ({ libraryName }: { libraryName: string }) => {
      try {
        const client = getClient();
        const response = await client.searchLibrary(libraryName);

        if (!response.results || response.results.length === 0) {
          return {
            success: false,
            error: "No libraries found matching your query.",
            suggestions: "Try a different search term or check the library name.",
          };
        }

        return {
          success: true,
          results: response.results,
          totalResults: response.results.length,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to search libraries",
          suggestions: "Check your API key and try again, or try a different search term.",
        };
      }
    },
  });
}
