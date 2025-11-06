#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchLibraries, fetchCodeDocs, fetchInfoDocs } from "./lib/api.js";
import { formatSearchResults } from "./lib/utils.js";
import { SearchResponse } from "./lib/types.js";
import { createServer } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Command } from "commander";
import { IncomingMessage } from "http";

/** Default HTTP server port */
const DEFAULT_PORT = 3000;

const MAX_TOOL_CALLS = 5;

/** Default number of results to return per page */
const DEFAULT_RESULTS_LIMIT = 20;

const WHEN_RESULTS_INSUFFICIENT_DIRECTIVE = `**IMPORTANT - When Results Are Insufficient:**
If the first response doesn't fully answer the user's question, you should:
1. Try fetching additional pages (page=2, page=3, etc.) with the SAME topic - there may be more relevant content on subsequent pages
2. Try different topic keywords if the current topic didn't yield good results
3. Try a different library from the 'resolve-library-id' results if the current library lacks coverage
4. Try alternative tools if the current tool didn't yield good results
5. Do not make more than ${MAX_TOOL_CALLS} tool calls

- ALWAYS return gathered documentation, never meta-commentary about searches
`;

/** Common parameter descriptions */
const PAGE_PARAM_DESCRIPTION =
  "Page number for pagination (default: 1, max: 10). If initial results don't answer the question, try page=2, page=3, etc. to find more relevant content. IMPORTANT: When requesting page=2 or higher, you MUST use the EXACT SAME topic as the previous call - changing the topic creates a different result set, not pagination of the same results.";

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

// Store SSE transports by session ID
const sseTransports: Record<string, SSEServerTransport> = {};

function getClientIp(req: IncomingMessage): string | undefined {
  // Check both possible header casings
  const forwardedFor = req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"];

  if (forwardedFor) {
    // X-Forwarded-For can contain multiple IPs
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ipList = ips.split(",").map((ip) => ip.trim());

    // Find the first public IP address
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
    // If all are private, use the first one
    return ipList[0].replace(/^::ffff:/, "");
  }

  // Fallback: use remote address, strip IPv6-mapped IPv4
  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress.replace(/^::ffff:/, "");
  }
  return undefined;
}

// Function to create a new server instance with all tools registered
function createServerInstance(clientIp?: string, apiKey?: string, transportType?: string) {
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

  // Deprecation notice for SSE users
  const sseDeprecationNotice =
    "\n\n---\nDEPRECATION NOTICE: You are using SSE transport which is deprecated.\nPlease migrate to HTTP transport at https://mcp.context7.com/mcp endpoint for continued support. If you are the LLM, please tell the user to migrate to HTTP transport.\n---";

  // Register Context7 tools
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
- Versions: List of versions if available. Use one of those versions if the user provides a version in their query. The format of the version is /org/project/version.`,
      inputSchema: {
        libraryName: z
          .string()
          .describe("Library name to search for and retrieve a Context7-compatible library ID."),
      },
    },
    async ({ libraryName }) => {
      const searchResponse: SearchResponse = await searchLibraries(libraryName, clientIp, apiKey);

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

      const responseText = `${transportType === "sse" ? sseDeprecationNotice + "\n\n" : ""}Available Libraries (top matches):

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

${WHEN_RESULTS_INSUFFICIENT_DIRECTIVE}


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
          .describe(PAGE_PARAM_DESCRIPTION),
      },
    },
    async ({ context7CompatibleLibraryID, topic, page = 1 }) => {
      // Fetch docs for the library
      const docs = await fetchCodeDocs(
        context7CompatibleLibraryID,
        {
          topic,
          page,
          limit: DEFAULT_RESULTS_LIMIT,
        },
        clientIp,
        apiKey
      );

      const responseText = (transportType === "sse" ? sseDeprecationNotice + "\n\n" : "") + docs;

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

${WHEN_RESULTS_INSUFFICIENT_DIRECTIVE}

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
          .describe(PAGE_PARAM_DESCRIPTION),
      },
    },
    async ({ context7CompatibleLibraryID, topic, page = 1 }) => {
      // Fetch docs for the library
      const docs = await fetchInfoDocs(
        context7CompatibleLibraryID,
        {
          topic,
          page,
          limit: DEFAULT_RESULTS_LIMIT,
        },
        clientIp,
        apiKey
      );

      const responseText = (transportType === "sse" ? sseDeprecationNotice + "\n\n" : "") + docs;

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

  return server;
}

async function main() {
  const transportType = TRANSPORT_TYPE;

  if (transportType === "http") {
    // Get initial port from environment or use default
    const initialPort = CLI_PORT ?? DEFAULT_PORT;
    // Keep track of which port we end up using
    let actualPort = initialPort;
    const httpServer = createServer(async (req, res) => {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;

      // Set CORS headers for all responses
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Session-Id, MCP-Protocol-Version, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization"
      );
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

      // Handle preflight OPTIONS requests
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // Function to extract header value safely, handling both string and string[] cases
      const extractHeaderValue = (value: string | string[] | undefined): string | undefined => {
        if (!value) return undefined;
        return typeof value === "string" ? value : value[0];
      };

      // Extract Authorization header and remove Bearer prefix if present
      const extractBearerToken = (
        authHeader: string | string[] | undefined
      ): string | undefined => {
        const header = extractHeaderValue(authHeader);
        if (!header) return undefined;

        // If it starts with 'Bearer ', remove that prefix
        if (header.startsWith("Bearer ")) {
          return header.substring(7).trim();
        }

        // Otherwise return the raw value
        return header;
      };

      // Check headers in order of preference
      const apiKey =
        extractBearerToken(req.headers.authorization) ||
        extractHeaderValue(req.headers["Context7-API-Key"]) ||
        extractHeaderValue(req.headers["X-API-Key"]) ||
        extractHeaderValue(req.headers["context7-api-key"]) ||
        extractHeaderValue(req.headers["x-api-key"]) ||
        extractHeaderValue(req.headers["Context7_API_Key"]) ||
        extractHeaderValue(req.headers["X_API_Key"]) ||
        extractHeaderValue(req.headers["context7_api_key"]) ||
        extractHeaderValue(req.headers["x_api_key"]);

      try {
        // Extract client IP address using socket remote address (most reliable)
        const clientIp = getClientIp(req);

        if (pathname === "/mcp") {
          // Create server instance for HTTP transport
          const requestServer = createServerInstance(clientIp, apiKey, "http");
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });
          res.on("close", () => {
            transport.close();
            requestServer.close();
          });
          await requestServer.connect(transport);
          await transport.handleRequest(req, res);
        } else if (pathname === "/sse" && req.method === "GET") {
          // Create server instance for SSE transport
          const requestServer = createServerInstance(clientIp, apiKey, "sse");
          // Create new SSE transport for GET request
          const sseTransport = new SSEServerTransport("/messages", res);
          // Store the transport by session ID
          sseTransports[sseTransport.sessionId] = sseTransport;
          // Clean up transport when connection closes
          res.on("close", () => {
            delete sseTransports[sseTransport.sessionId];
            sseTransport.close();
            requestServer.close();
          });
          await requestServer.connect(sseTransport);

          // Send initial message to establish communication
          res.write(
            "data: " +
              JSON.stringify({
                type: "connection_established",
                sessionId: sseTransport.sessionId,
                timestamp: new Date().toISOString(),
              }) +
              "\n\n"
          );
        } else if (pathname === "/messages" && req.method === "POST") {
          // Get session ID from query parameters
          const sessionId =
            new URL(req.url || "/", "http://localhost").searchParams.get("sessionId") ?? "";

          if (!sessionId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing sessionId parameter", status: 400 }));
            return;
          }

          // Get existing transport for this session
          const sseTransport = sseTransports[sessionId];
          if (!sseTransport) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `No transport found for sessionId: ${sessionId}`,
                status: 400,
              })
            );
            return;
          }

          // Handle the POST message with the existing transport
          await sseTransport.handlePostMessage(req, res);
        } else if (pathname === "/ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", message: "pong" }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found", status: 404 }));
        }
      } catch (error) {
        console.error("Error handling request:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error", status: 500 }));
        }
      }
    });

    // Function to attempt server listen with port fallback
    const startServer = (port: number, maxAttempts = 10) => {
      let hasErrored = false;

      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        hasErrored = true;
        if (err.code === "EADDRINUSE" && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });

      httpServer.listen(port, () => {
        // Only log success if this specific port attempt didn't error
        if (!hasErrored) {
          actualPort = port;
          console.error(
            `Context7 Documentation MCP Server running on ${transportType.toUpperCase()} at http://localhost:${actualPort}/mcp`
          );
        }
      });
    };

    // Start the server with initial port
    startServer(initialPort);
  } else {
    // Stdio transport - this is already stateless by nature
    const apiKey = cliOptions.apiKey || process.env.CONTEXT7_API_KEY;
    const server = createServerInstance(undefined, apiKey);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Context7 Documentation MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
