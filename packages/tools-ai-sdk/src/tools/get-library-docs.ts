import { tool } from "ai";
import { z } from "zod";
import { Context7 } from "@upstash/context7-sdk";
import type { Context7ToolsConfig } from "./types";
import { GET_LIBRARY_DOCS_DESCRIPTION } from "@prompts";

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
export function getLibraryDocs(config: Context7ToolsConfig = {}) {
  const { apiKey, defaultMaxResults = 10 } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: GET_LIBRARY_DOCS_DESCRIPTION,
    inputSchema: z.object({
      libraryId: z
        .string()
        .describe(
          "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v14.3.0-canary.87') retrieved from 'resolveLibrary' or directly from user query in the format '/org/project' or '/org/project/version'."
        ),
      mode: z
        .enum(["code", "info"])
        .optional()
        .default("code")
        .describe(
          "Documentation mode: 'code' for API references and code examples (default), 'info' for conceptual guides, narrative information, and architectural questions."
        ),
      topic: z
        .string()
        .optional()
        .describe("Topic to focus documentation on (e.g., 'hooks', 'routing')."),
      page: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Page number for pagination (start: 1, default: 1). If the context is not sufficient, try page=2, page=3, page=4, etc. with the same topic."
        ),
    }),
    execute: async ({
      libraryId,
      mode = "code",
      topic,
      page = 1,
    }: {
      libraryId: string;
      mode?: "code" | "info";
      topic?: string;
      page?: number;
    }) => {
      try {
        const client = getClient();
        const baseOptions = {
          page,
          limit: defaultMaxResults,
          topic: topic?.trim() || undefined,
        };

        const response =
          mode === "info"
            ? await client.getDocs(libraryId, { ...baseOptions, mode: "info" })
            : await client.getDocs(libraryId, { ...baseOptions, mode: "code" });

        if (!response.snippets?.length) {
          return {
            success: false,
            error:
              "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolveLibrary' with the package name you wish to retrieve documentation for.",
            libraryId,
          };
        }

        return {
          success: true,
          libraryId,
          snippets: response.snippets,
          pagination: response.pagination,
          totalTokens: response.totalTokens,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch documentation",
          libraryId,
        };
      }
    },
  });
}
