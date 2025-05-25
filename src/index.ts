#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchLibraries, fetchLibraryDocumentation } from "./lib/api.js";
import { formatSearchResults } from "./lib/utils.js";
import { Command } from "commander";

const program = new Command();

program
  .name("context7-mcp")
  .description(
    "Context7 MCP Server - Retrieves up-to-date documentation and code examples for any library"
  )
  .version("1.0.6")
  .option(
    "-t, --default-minimum-tokens <number>",
    "Set the minimum token count for documentation retrieval",
    "10000"
  );

program.parse();

const options = program.opts();

let DEFAULT_MINIMUM_TOKENS = 10000;
const parsedValue = parseInt(options.defaultMinimumTokens, 10);
if (!isNaN(parsedValue) && parsedValue > 0) {
  DEFAULT_MINIMUM_TOKENS = parsedValue;
} else {
  console.warn(
    `Warning: Invalid DEFAULT_MINIMUM_TOKENS value provided. Using default value of 10000`
  );
}

// Create server instance
const server = new McpServer({
  name: "Context7",
  description: "Retrieves up-to-date documentation and code examples for any library.",
  version: "1.0.6",
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register Context7 tools
server.tool(
  "resolve-library-id",
  `Resolves a package/product name to a Context7-compatible library ID and returns a list of matching libraries.

You MUST call this function before 'get-library-docs' to obtain a valid Context7-compatible library ID UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Selection Process:
1. Analyze the query to understand what library/package the user is looking for
2. Return the most relevant match based on:
- Name similarity to the query (exact matches prioritized)
- Description relevance to the query's intent
- Documentation coverage (prioritize libraries with higher Code Snippet counts)
- Trust score (consider libraries with scores of 7-10 more authoritative)

Response Format:
- Return the selected library ID in a clearly marked section
- Provide a brief explanation for why this library was chosen
- If multiple good matches exist, acknowledge this but proceed with the most relevant one
- If no good matches exist, clearly state this and suggest query refinements

For ambiguous queries, request clarification before proceeding with a best-guess match.`,
  {
    libraryName: z
      .string()
      .describe("Library name to search for and retrieve a Context7-compatible library ID."),
  },
  async ({ libraryName }) => {
    const searchResponse = await searchLibraries(libraryName);

    if (!searchResponse || !searchResponse.results) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve library documentation data from Context7",
          },
        ],
      };
    }

    if (searchResponse.results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No documentation libraries available",
          },
        ],
      };
    }

    const resultsText = formatSearchResults(searchResponse);

    return {
      content: [
        {
          type: "text",
          text: `Available Libraries (top matches):

Each result includes:
- Library ID: Context7-compatible identifier (format: /org/project)
- Name: Library or package name
- Description: Short summary
- Code Snippets: Number of available code examples
- Trust Score: Authority indicator
- Versions: List of versions if available. Use one of those versions if and only if the user explicitly provides a version in their query.

For best results, select libraries based on name match, trust score, snippet coverage, and relevance to your use case.

----------

${resultsText}`,
        },
      ],
    };
  }
);

server.tool(
  "get-library-docs",
  "Fetches up-to-date documentation for a library. You must call 'resolve-library-id' first to obtain the exact Context7-compatible library ID required to use this tool, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.",
  {
    context7CompatibleLibraryID: z
      .string()
      .describe(
        "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v14.3.0-canary.87') retrieved from 'resolve-library-id' or directly from user query in the format '/org/project' or '/org/project/version'."
      ),
    topic: z
      .string()
      .optional()
      .describe("Topic to focus documentation on (e.g., 'hooks', 'routing')."),
    tokens: z
      .preprocess((val) => (typeof val === "string" ? Number(val) : val), z.number())
      .transform((val) => (val < DEFAULT_MINIMUM_TOKENS ? DEFAULT_MINIMUM_TOKENS : val))
      .optional()
      .describe(
        `Maximum number of tokens of documentation to retrieve (default: ${DEFAULT_MINIMUM_TOKENS}). Higher values provide more context but consume more tokens.`
      ),
    userQuery: z
      .string()
      .describe(
        "Initial user query that triggered this tool call. Provide the user query as it is. Do not modify it or change it in any way. Do not add any additional information to the query."
      ),
  },
  async ({
    context7CompatibleLibraryID,
    tokens = DEFAULT_MINIMUM_TOKENS,
    topic = "",
    userQuery,
  }) => {
    const documentationText = await fetchLibraryDocumentation(context7CompatibleLibraryID, {
      tokens,
      topic,
      userQuery,
    });

    if (!documentationText) {
      return {
        content: [
          {
            type: "text",
            text: "Documentation not found or not finalized for this library. This might have happened because you used an invalid Context7-compatible library ID. To get a valid Context7-compatible library ID, use the 'resolve-library-id' with the package name you wish to retrieve documentation for.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: documentationText,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Context7 Documentation MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
