import { tool } from "ai";
import { z } from "zod";
import { Context7, type SearchResult } from "@upstash/context7-sdk";
import { RESOLVE_LIBRARY_PROMPT } from "../prompts";

/**
 * Configuration for Context7 tools
 */
export interface Context7ToolsConfig {
  /**
   * Context7 API key. If not provided, will use CONTEXT7_API_KEY environment variable.
   */
  apiKey?: string;
  /**
   * Default maximum number of documentation results per page.
   * @default 10
   */
  defaultMaxResults?: number;
}

/**
 * Formats search results for agent consumption
 */
function formatSearchResults(results: SearchResult[]): string {
  if (!results || results.length === 0) {
    return "No results found.";
  }

  return results
    .map((result, index) => {
      const trustScore = result.trustScore
        ? result.trustScore >= 0.7
          ? "High"
          : result.trustScore >= 0.4
            ? "Medium"
            : "Low"
        : "Unknown";

      const versions = result.versions?.length ? `\n  Versions: ${result.versions.join(", ")}` : "";

      return `${index + 1}. ${result.title}
  Library ID: ${result.id}
  Description: ${result.description}
  Code Snippets: ${result.totalSnippets}
  Source Reputation: ${trustScore}
  Benchmark Score: ${result.benchmarkScore || "N/A"}${versions}`;
    })
    .join("\n\n");
}

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
 * import { resolveLibrary, getLibraryDocs } from '@upstash/context7-ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * // Simple usage - uses CONTEXT7_API_KEY env var
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibrary: resolveLibrary(),
 *     getLibraryDocs: getLibraryDocs(),
 *   },
 * });
 *
 * // With custom config
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibrary: resolveLibrary({ apiKey: 'your-api-key' }),
 *     getLibraryDocs: getLibraryDocs({ apiKey: 'your-api-key' }),
 *   },
 * });
 * ```
 */
export function resolveLibrary(config: Context7ToolsConfig = {}) {
  const { apiKey = process.env.CONTEXT7_API_KEY } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: RESOLVE_LIBRARY_PROMPT,
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

        const resultsText = formatSearchResults(response.results);
        const topResult = response.results[0]!;

        return {
          success: true,
          results: resultsText,
          totalResults: response.results.length,
          topMatch: {
            id: topResult.id,
            name: topResult.title,
            description: topResult.description,
          },
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
 * import { resolveLibrary, getLibraryDocs } from '@upstash/context7-ai-sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * // Simple usage - uses CONTEXT7_API_KEY env var
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibrary: resolveLibrary(),
 *     getLibraryDocs: getLibraryDocs(),
 *   },
 * });
 *
 * // With custom config
 * const { text } = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Find React documentation about hooks',
 *   tools: {
 *     resolveLibrary: resolveLibrary({ apiKey: 'your-api-key' }),
 *     getLibraryDocs: getLibraryDocs({
 *       apiKey: 'your-api-key',
 *       defaultMaxResults: 5,
 *     }),
 *   },
 * });
 * ```
 */
export function getLibraryDocs(config: Context7ToolsConfig = {}) {
  const { apiKey = process.env.CONTEXT7_API_KEY, defaultMaxResults = 10 } = config;
  const getClient = () => new Context7({ apiKey });

  return tool({
    description: `Fetches up-to-date documentation for a library. You must call 'resolveLibrary' first to obtain the exact Context7-compatible library ID required to use this tool, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.`,
    inputSchema: z.object({
      libraryId: z
        .string()
        .describe(
          "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v14.3.0-canary.87') retrieved from 'resolveLibrary' or directly from user query in the format '/org/project' or '/org/project/version'."
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
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Optional: Maximum number of documentation pages to retrieve (default: 10)"),
    }),
    execute: async ({
      libraryId,
      topic,
      page = 1,
      maxResults = defaultMaxResults,
    }: {
      libraryId: string;
      topic?: string;
      page?: number;
      maxResults?: number;
    }) => {
      try {
        const client = getClient();
        const response = await client.getDocs(libraryId, {
          page,
          limit: maxResults,
          topic: topic?.trim() || undefined,
          format: "txt",
        });

        if (!response.content) {
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
          documentation: response.content,
          pagination: response.pagination,
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
