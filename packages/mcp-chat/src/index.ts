#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Command } from "commander";

const CONTEXT7_API_BASE_URL = "https://context7.com/api";

interface ChatQueryResponse {
  response: string;
}

interface ChatQueryErrorResponse {
  error: string;
}

/**
 * Generates appropriate error messages based on HTTP status codes
 */
function createErrorMessage(errorCode: number, apiKey?: string): string {
  switch (errorCode) {
    case 401:
      if (!apiKey) {
        return "Unauthorized. API key is required. Get your API key at https://context7.com/dashboard";
      }
      return "Unauthorized. Please check your API key. API keys should start with 'ctx7sk-'.";
    case 429:
      return "Rate limited due to too many requests. Please try again later.";
    case 400:
      return "Bad request. Please check your query parameters.";
    case 500:
      return "Server error. Please try again later.";
    default:
      return `Request failed with status ${errorCode}. Please try again later.`;
  }
}

const program = new Command()
  .option("--api-key <key>", "API key for authentication (or set CONTEXT7_API_KEY env var)")
  .option(
    "--model <id>",
    "OpenRouter model ID to use for generating responses (e.g., 'google/gemini-2.5-flash', 'openai/gpt-oss-120b')"
  )
  .allowUnknownOption()
  .parse(process.argv);

const cliOptions = program.opts<{ apiKey?: string; model?: string }>();
const apiKey = cliOptions.apiKey || process.env.CONTEXT7_API_KEY;
const model = cliOptions.model;

if (!apiKey) {
  console.error(
    "Warning: No API key provided. Set CONTEXT7_API_KEY environment variable or use --api-key flag. Get your API key at https://context7.com/dashboard"
  );
}

const server = new McpServer(
  {
    name: "Context7 Chat",
    version: "0.0.1",
  },
  {
    instructions: `Use this server to get AI-powered answers about library documentation.

Use this when you need:
- Quick answers about how to use a library or API
- Code examples and implementation guidance
- Explanations of library concepts and best practices

Responses are generated using up-to-date documentation, ensuring accurate and current information.`,
  }
);

server.registerTool(
  "query-docs",
  {
    title: "Query Docs",
    description: `Ask a question about any library and get an AI-powered answer based on up-to-date documentation.

Returns a formatted markdown response with accurate, current information about the specified library.

When to use:
- When you need to understand how to use a specific library feature
- When you want code examples for a particular use case
- When you need explanations of library concepts, APIs, or best practices

The 'library' parameter is optional but recommended for more focused results.

Examples:
- query: "How do I create a checkout session?", library: "stripe"
- query: "How to set up server-side rendering?", library: "nextjs"
- query: "What are React hooks and how do I use useState?"`,
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe(
          "Your question about a library (e.g., 'How do I create a checkout session?', 'How to handle authentication?')"
        ),
      library: z
        .string()
        .optional()
        .describe(
          "Library to focus the search on (e.g., 'stripe', 'react', 'nextjs', 'supabase'). Recommended for more accurate results."
        ),
    },
  },
  async ({ query, library }) => {
    if (!apiKey) {
      return {
        content: [
          {
            type: "text",
            text: "Error: API key is required. Please provide a Context7 API key via --api-key flag or CONTEXT7_API_KEY environment variable. Get your API key at https://context7.com/dashboard",
          },
        ],
      };
    }

    try {
      const response = await fetch(`${CONTEXT7_API_BASE_URL}/v2/chat-query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          library,
          ...(model && { model }),
        }),
      });

      if (!response.ok) {
        const errorCode = response.status;
        // Try to get error message from response, fall back to our error messages
        const errorData = (await response
          .json()
          .catch(() => null)) as ChatQueryErrorResponse | null;
        const errorMessage = errorData?.error || createErrorMessage(errorCode, apiKey);
        return {
          content: [{ type: "text", text: `Error: ${errorMessage}` }],
        };
      }

      const data = (await response.json()) as ChatQueryResponse;

      return {
        content: [{ type: "text", text: data.response }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : "An unexpected error occurred"}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Context7 Chat MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
