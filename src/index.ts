#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchLibraries, fetchCodeDocs, fetchInfoDocs } from "./lib/api.js";
import { formatSearchResults } from "./lib/utils.js";
import { SearchResponse } from "./lib/types.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Command } from "commander";
import { AsyncLocalStorage } from "async_hooks";

/** Default HTTP server port */
const DEFAULT_PORT = 3000;

// Parse CLI arguments using commander
const program = new Command()
  .option("--transport <stdio|http>", "transport type", "stdio")
  .option("--port <number>", "port for HTTP transport", DEFAULT_PORT.toString())
  .option("--api-key <key>", "API key for authentication (or set CONTEXT7_API_KEY env var)")
  .allowUnknownOption() // let MCP Inspector / other wrappers pass through extra flags
  .parse(process.argv);

const cliOptions = program.opts<{
  transport: string;
  port: string;
  apiKey?: string;
}>();

// Validate transport option
const allowedTransports = ["stdio", "http"];
if (!allowedTransports.includes(cliOptions.transport)) {
  console.error(
    `Invalid --transport value: '${cliOptions.transport}'. Must be one of: stdio, http.`
  );
  process.exit(1);
}

// Transport configuration
const TRANSPORT_TYPE = (cliOptions.transport || "stdio") as "stdio" | "http";

// Disallow incompatible flags based on transport
const passedPortFlag = process.argv.includes("--port");
const passedApiKeyFlag = process.argv.includes("--api-key");

if (TRANSPORT_TYPE === "http" && passedApiKeyFlag) {
  console.error(
    "The --api-key flag is not allowed when using --transport http. Use header-based auth at the HTTP layer instead."
  );
  process.exit(1);
}

if (TRANSPORT_TYPE === "stdio" && passedPortFlag) {
  console.error("The --port flag is not allowed when using --transport stdio.");
  process.exit(1);
}

// HTTP port configuration
const CLI_PORT = (() => {
  const parsed = parseInt(cliOptions.port, 10);
  return isNaN(parsed) ? undefined : parsed;
})();

const requestContext = new AsyncLocalStorage<{
  clientIp?: string;
  apiKey?: string;
}>();

function getClientIp(req: express.Request): string | undefined {
  const forwardedFor = req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"];

  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ipList = ips.split(",").map((ip) => ip.trim());

    for (const ip of ipList) {
      const plainIp = ip.replace(/^::ffff:/, "");
      if (
        !plainIp.startsWith("10.") &&
        !plainIp.startsWith("192.168.") &&
        !/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(plainIp)
      ) {
        return plainIp;
      }
    }
    return ipList[0].replace(/^::ffff:/, "");
  }

  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress.replace(/^::ffff:/, "");
  }
  return undefined;
}

const server = new McpServer(
  {
    name: "Context7",
    version: "1.0.13",
  },
  {
    instructions:
      "Use this server to retrieve up-to-date documentation and code examples for any library.",
  }
);

server.registerTool(
  "resolve-library-id",
  {
    title: "Resolve Context7 Library ID",
    description: `Resolves a package/product name to a Context7-compatible library ID and returns a list of matching libraries.

You MUST call this function before 'get-coding-and-api-docs' or 'get-informational-docs' to obtain a valid Context7-compatible library ID UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

After receiving results, select the most relevant library by analyzing:
- Name similarity to the query (exact matches prioritized)
- Description relevance to the query's intent
- Documentation coverage (prioritize libraries with higher Code Snippet counts)
- Source reputation (consider libraries with High or Medium reputation more authoritative)

Then clearly state which library ID you selected and why. If no good matches exist, inform the user and suggest query refinements.

Result Fields:
- Library ID: Context7-compatible identifier (format: /org/project or /org/project/version)
- Title: Library or package name
- Description: Short summary
- Code Snippets: Number of available code examples
- Source Reputation: Authority indicator (High, Medium, Low, or Unknown)
- Benchmark Score: Quality indicator (100 is the highest score)
- Versions: List of versions if available. Use one of those versions if the user provides a version in their query. The format of the version is /org/project/version.

For ambiguous queries, request clarification before proceeding with a best-guess match.`,
    inputSchema: {
      libraryName: z
        .string()
        .describe("Library name to search for and retrieve a Context7-compatible library ID."),
    },
  },
  async ({ libraryName }) => {
    const ctx = requestContext.getStore();
    const searchResponse: SearchResponse = await searchLibraries(
      libraryName,
      ctx?.clientIp,
      ctx?.apiKey
    );

    if (!searchResponse.results || searchResponse.results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: searchResponse.error
              ? searchResponse.error
              : "Failed to retrieve library documentation data from Context7",
          },
        ],
      };
    }

    const resultsText = formatSearchResults(searchResponse);

    const responseText = `Available Libraries (top matches):

----------

${resultsText}`;

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  }
);

server.registerTool(
  "get-coding-and-api-docs",
  {
    title: "Get Coding and API Documentation",
    description: `Fetches code snippets, API references, function signatures, implementation examples, guides, and tutorials for a library.

When to use:
- User needs practical code examples, guides, or tutorials
- User asks "how to" questions about implementation
- User wants API usage patterns or technical implementation details
- If you are not sure which tool to use, use this tool

Prerequisites:
- Must call 'resolve-library-id' first to get valid library ID, UNLESS user explicitly provides ID in format '/org/project' or '/org/project/version'

Using the topic parameter:
- Extract semantic topics from user queries to significantly improve result relevance
- Examples: "how to authenticate" → topic="authentication", "Next.js routing" → topic="routing", "database connections" → topic="database"
- Use topics liberally - even broad queries often have extractable topics
- Omit when you want to get default summarized documentation for the library

**IMPORTANT - When Results Are Insufficient:**
If the first response doesn't fully answer the user's question, you should:
1. Try fetching additional pages (page=2, page=3, etc.) - there may be more relevant content on subsequent pages
2. Try different topic keywords if the current topic didn't yield good results
3. Try 'get-informational-docs' if code examples aren't available or if you need conceptual context
4. Try a different library from the 'resolve-library-id' results if the current library lacks coverage

Be proactive and exploratory - don't stop at the first result if it's insufficient.
`,
    inputSchema: {
      context7CompatibleLibraryID: z
        .string()
        .describe(
          "Library ID to fetch documentation from. Must be in the format '/org/project' or '/org/project/version' (e.g., '/vercel/next.js')."
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Semantic topic to filter and improve result relevance. Extract from user query (e.g., 'Next.js authentication setup' → 'authentication', 'how to query MongoDB' → 'database queries'). Using topics improves result quality. Only omit if query is too broad to extract a topic."
        ),
      page: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(1)
        .describe(
          "Page number for pagination (default: 1, max: 10). If initial results don't answer the question, try page=2, page=3, etc. to find more relevant content."
        ),
      limit: z
        .number()
        .int()
        .min(10)
        .max(50)
        .optional()
        .default(20)
        .describe("Number of results to return (default: 20, max: 50)."),
    },
  },
  async ({ context7CompatibleLibraryID, topic, page = 1, limit = 10 }) => {
    const ctx = requestContext.getStore();

    const docs = await fetchCodeDocs(
      context7CompatibleLibraryID,
      {
        topic,
        page,
        limit,
      },
      ctx?.clientIp,
      ctx?.apiKey
    );

    return {
      content: [
        {
          type: "text",
          text: docs,
        },
      ],
    };
  }
);

server.registerTool(
  "get-informational-docs",
  {
    title: "Get Informational Documentation",
    description: `Fetches narrative documentation and architecture explanations for a library.

When to use:
- User wants to understand concepts, architecture, or design decisions
- Plan, pricing, or other non-technical information
- User asks "what is" or "why does X work this way" questions
- User needs high-level understanding without code examples
- When 'get-coding-and-api-docs' doesn't have enough context or background information
- If code/API examples would help answer the question, use 'get-coding-and-api-docs' instead
- If you are not sure which tool to use, use 'get-coding-and-api-docs'

Prerequisites:
- Must call 'resolve-library-id' first to get valid library ID, UNLESS user explicitly provides ID in format '/org/project' or '/org/project/version'

Using the topic parameter:
- Extract semantic topics from user queries to significantly improve result relevance
- Examples: "Next.js architecture" → topic="architecture", "React concepts" → topic="concepts", "deployment best practices" → topic="deployment"
- Use topics liberally - even broad conceptual queries often have extractable topics
- Never omit the topic parameter

**IMPORTANT - When Results Are Insufficient:**
If the first response doesn't fully answer the user's question, you should:
1. Try fetching additional pages (page=2, page=3, etc.) - there may be more relevant content on subsequent pages
2. Try different topic keywords if the current topic didn't yield good results
3. Try 'get-coding-and-api-docs' if you need code examples or implementation details
4. Try a different library from the 'resolve-library-id' results if the current library lacks coverage

Be proactive and exploratory - don't stop at the first result if it's insufficient.
`,
    inputSchema: {
      context7CompatibleLibraryID: z
        .string()
        .describe(
          "Library ID to fetch documentation from. Must be in the format '/org/project' or '/org/project/version' (e.g., '/vercel/next.js')."
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Semantic topic to filter and improve result relevance. Extract from user query (e.g., 'getting started guide' → 'getting started', 'architecture overview' → 'architecture'). Using topics improves result quality. Only omit if query is too broad to extract a topic."
        ),
      page: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(1)
        .describe(
          "Page number for pagination (default: 1, max: 10). If initial results don't answer the question, try page=2, page=3, etc. to find more relevant content."
        ),
      limit: z
        .number()
        .int()
        .min(10)
        .max(50)
        .optional()
        .default(20)
        .describe("Number of results to return (default: 20, max: 50)."),
    },
  },
  async ({ context7CompatibleLibraryID, topic, page = 1, limit = 10 }) => {
    const ctx = requestContext.getStore();

    const docs = await fetchInfoDocs(
      context7CompatibleLibraryID,
      {
        topic,
        page,
        limit,
      },
      ctx?.clientIp,
      ctx?.apiKey
    );

    return {
      content: [
        {
          type: "text",
          text: docs,
        },
      ],
    };
  }
);

async function main() {
  const transportType = TRANSPORT_TYPE;

  if (transportType === "http") {
    const initialPort = CLI_PORT ?? DEFAULT_PORT;
    let actualPort = initialPort;

    const app = express();
    app.use(express.json());

    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Session-Id, MCP-Protocol-Version, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization"
      );
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });

    const extractHeaderValue = (value: string | string[] | undefined): string | undefined => {
      if (!value) return undefined;
      return typeof value === "string" ? value : value[0];
    };

    const extractBearerToken = (authHeader: string | string[] | undefined): string | undefined => {
      const header = extractHeaderValue(authHeader);
      if (!header) return undefined;

      if (header.startsWith("Bearer ")) {
        return header.substring(7).trim();
      }

      return header;
    };

    const extractApiKey = (req: express.Request): string | undefined => {
      return (
        extractBearerToken(req.headers.authorization) ||
        extractHeaderValue(req.headers["Context7-API-Key"]) ||
        extractHeaderValue(req.headers["X-API-Key"]) ||
        extractHeaderValue(req.headers["context7-api-key"]) ||
        extractHeaderValue(req.headers["x-api-key"]) ||
        extractHeaderValue(req.headers["Context7_API_Key"]) ||
        extractHeaderValue(req.headers["X_API_Key"]) ||
        extractHeaderValue(req.headers["context7_api_key"]) ||
        extractHeaderValue(req.headers["x_api_key"])
      );
    };

    app.post("/mcp", async (req: express.Request, res: express.Response) => {
      try {
        const clientIp = getClientIp(req);
        const apiKey = extractApiKey(req);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on("close", () => {
          transport.close();
        });

        await requestContext.run({ clientIp, apiKey }, async () => {
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
        });
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    app.get("/ping", (_req: express.Request, res: express.Response) => {
      res.json({ status: "ok", message: "pong" });
    });

    // Catch-all 404 handler - must be after all other routes
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({
        error: "not_found",
        message: "Endpoint not found. Use /mcp for MCP protocol communication.",
      });
    });

    const startServer = (port: number, maxAttempts = 10) => {
      const httpServer = app.listen(port, () => {
        actualPort = port;
        console.error(
          `Context7 Documentation MCP Server running on HTTP at http://localhost:${actualPort}/mcp`
        );
      });

      httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });
    };

    startServer(initialPort);
  } else {
    const apiKey = cliOptions.apiKey || process.env.CONTEXT7_API_KEY;
    const transport = new StdioServerTransport();

    await requestContext.run({ apiKey }, async () => {
      await server.connect(transport);
    });

    console.error("Context7 Documentation MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
