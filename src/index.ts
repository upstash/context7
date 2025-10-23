#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchLibraries, fetchCodeDocs, fetchInfoDocs } from "./lib/api.js";
import { formatSearchResults, formatMultiLibraryDocs } from "./lib/utils.js";
import { SearchResponse } from "./lib/types.js";
import { createServer } from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Command } from "commander";
import { IncomingMessage } from "http";

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
function createServerInstance(clientIp?: string, apiKey?: string) {
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

  // Register Context7 tools
  server.registerTool(
    "resolve-library-id",
    {
      title: "Resolve Context7 Library ID",
      description: `Resolves a package/product name to a Context7-compatible library ID and returns a list of matching libraries.

You MUST call this function before 'get-coding-and-api-docs' or 'get-informational-docs' to obtain a valid Context7-compatible library ID UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Selection Process:
1. Analyze the query to understand what library/package the user is looking for
2. Return the most relevant match based on:
- Name similarity to the query (exact matches prioritized)
- Description relevance to the query's intent
- Documentation coverage (prioritize libraries with higher Code Snippet counts)
- Trust level (consider libraries with Secure or Moderate levels more authoritative)

Response Format:
- Return the selected library ID in a clearly marked section
- Provide a brief explanation for why this library was chosen
- If multiple good matches exist, acknowledge this but proceed with the most relevant one
- If no good matches exist, clearly state this and suggest query refinements

For ambiguous queries, request clarification before proceeding with a best-guess match.`,
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
- Trust Level: Categorized authority indicator (Secure, Moderate, or Unknown)
- Benchmark Score: Quality indicator
- Versions: List of versions if available. Use one of those versions if the user provides a version in their query. The format of the version is /org/project/version.

For best results, select libraries based on name match, trust level, snippet coverage, and relevance to your use case.

----------

${resultsText}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get-coding-and-api-docs",
    {
      title: "Get Coding and API Documentation",
      description:
        "Fetches code snippets, API references, function signatures, and implementation examples for a library. Use this tool when you need practical code examples, API usage patterns, or technical implementation details. You must call 'resolve-library-id' first to obtain the exact Context7-compatible library ID, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query. Supports fetching from multiple libraries at once.",
      inputSchema: {
        context7CompatibleLibraryID: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe(
            "Single library ID as string (e.g., '/vercel/next.js'), or array of library IDs to fetch docs from multiple libraries at once (e.g., ['/vercel/next.js', '/mongodb/docs']). Each ID should be in the format '/org/project' or '/org/project/version', retrieved from 'resolve-library-id' or directly from user query."
          ),
        topic: z
          .string()
          .optional()
          .describe(
            "Semantic search filter to focus on specific topics (e.g., 'authentication', 'routing', 'database queries'). Applied to all libraries when fetching multiple."
          ),
        page: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(1)
          .describe(
            "Page number for pagination (default: 1, max: 10). Applied to all libraries when fetching multiple."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe(
            "Number of items per page (default: 10, max: 50). Applied to all libraries when fetching multiple."
          ),
      },
    },
    async ({ context7CompatibleLibraryID, topic, page = 1, limit = 10 }) => {
      // Normalize to array
      const libraryIds = Array.isArray(context7CompatibleLibraryID)
        ? context7CompatibleLibraryID
        : [context7CompatibleLibraryID];

      // Fetch docs for each library
      const results = await Promise.all(
        libraryIds.map(async (libraryId) => {
          const docs = await fetchCodeDocs(
            libraryId,
            {
              topic,
              page,
              limit,
            },
            clientIp,
            apiKey
          );
          return { libraryId, docs };
        })
      );

      return {
        content: [
          {
            type: "text",
            text: formatMultiLibraryDocs(results),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get-informational-docs",
    {
      title: "Get Informational Documentation",
      description:
        "Fetches conceptual documentation, guides, tutorials, and architecture explanations for a library. Use this tool when you need to understand concepts, learn about features, or get high-level architectural information. You must call 'resolve-library-id' first to obtain the exact Context7-compatible library ID, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query. Supports fetching from multiple libraries at once.",
      inputSchema: {
        context7CompatibleLibraryID: z
          .union([z.string(), z.array(z.string()).min(1)])
          .describe(
            "Single library ID as string (e.g., '/vercel/next.js'), or array of library IDs to fetch docs from multiple libraries at once (e.g., ['/vercel/next.js', '/mongodb/docs']). Each ID should be in the format '/org/project' or '/org/project/version', retrieved from 'resolve-library-id' or directly from user query."
          ),
        topic: z
          .string()
          .optional()
          .describe(
            "Semantic search filter to focus on specific topics (e.g., 'getting started', 'architecture', 'best practices'). Applied to all libraries when fetching multiple."
          ),
        page: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .default(1)
          .describe(
            "Page number for pagination (default: 1, max: 10). Applied to all libraries when fetching multiple."
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe(
            "Number of items per page (default: 10, max: 50). Applied to all libraries when fetching multiple."
          ),
      },
    },
    async ({ context7CompatibleLibraryID, topic, page = 1, limit = 10 }) => {
      // Normalize to array
      const libraryIds = Array.isArray(context7CompatibleLibraryID)
        ? context7CompatibleLibraryID
        : [context7CompatibleLibraryID];

      // Fetch docs for each library
      const results = await Promise.all(
        libraryIds.map(async (libraryId) => {
          const docs = await fetchInfoDocs(
            libraryId,
            {
              topic,
              page,
              limit,
            },
            clientIp,
            apiKey
          );
          return { libraryId, docs };
        })
      );

      return {
        content: [
          {
            type: "text",
            text: formatMultiLibraryDocs(results),
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

        // Create new server instance for each request
        const requestServer = createServerInstance(clientIp, apiKey);

        if (pathname === "/mcp") {
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
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });

      httpServer.listen(port, () => {
        actualPort = port;
        console.error(
          `Context7 Documentation MCP Server running on ${transportType.toUpperCase()} at http://localhost:${actualPort}/mcp with SSE endpoint at /sse`
        );
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
