#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClientContext } from "./lib/encryption.js";
import { extractClientInfoFromUserAgent } from "./lib/utils.js";
import {
  resolveLibraryIdSchema,
  resolveLibraryIdDescription,
  queryDocsSchema,
  queryDocsDescription,
  executeResolveLibraryId,
  executeQueryDocs,
} from "./lib/tools.js";
import { isJWT, validateJWT } from "./lib/jwt.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Command } from "commander";
import { AsyncLocalStorage } from "async_hooks";
import { SERVER_VERSION, RESOURCE_URL, AUTH_SERVER_URL } from "./lib/constants.js";

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

const requestContext = new AsyncLocalStorage<ClientContext>();

// Global state for stdio mode only
let stdioApiKey: string | undefined;
let stdioClientInfo: { ide?: string; version?: string } | undefined;

/**
 * Get the effective client context
 */
function getClientContext(): ClientContext {
  const ctx = requestContext.getStore();

  // HTTP mode: context is fully populated from request
  if (ctx) {
    return ctx;
  }

  // stdio mode: use globals
  return {
    apiKey: stdioApiKey,
    clientInfo: stdioClientInfo,
    transport: "stdio",
  };
}

/**
 * Extract client IP address from request headers.
 * Handles X-Forwarded-For header for proxied requests.
 */
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
    version: SERVER_VERSION,
  },
  {
    instructions:
      "Use this server to retrieve up-to-date documentation and code examples for any library.",
  }
);

// Capture client info from MCP initialize handshake
server.server.oninitialized = () => {
  const clientVersion = server.server.getClientVersion();
  if (clientVersion) {
    stdioClientInfo = {
      ide: clientVersion.name,
      version: clientVersion.version,
    };
  }
};

server.registerTool(
  "resolve-library-id",
  {
    title: "Resolve Context7 Library ID",
    description: resolveLibraryIdDescription,
    inputSchema: resolveLibraryIdSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: await executeResolveLibraryId(args, getClientContext()) }],
  })
);

server.registerTool(
  "query-docs",
  {
    title: "Query Documentation",
    description: queryDocsDescription,
    inputSchema: queryDocsSchema,
    annotations: { readOnlyHint: true },
  },
  async (args) => ({
    content: [{ type: "text", text: await executeQueryDocs(args, getClientContext()) }],
  })
);

async function main() {
  const transportType = TRANSPORT_TYPE;

  if (transportType === "http") {
    const initialPort = CLI_PORT ?? DEFAULT_PORT;

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
        extractHeaderValue(req.headers["context7-api-key"]) ||
        extractHeaderValue(req.headers["x-api-key"]) ||
        extractHeaderValue(req.headers["context7_api_key"]) ||
        extractHeaderValue(req.headers["x_api_key"])
      );
    };

    const handleMcpRequest = async (
      req: express.Request,
      res: express.Response,
      requireAuth: boolean
    ) => {
      // Reject GET requests — this server is stateless and does not send server-initiated
      // notifications, so SSE streams serve no purpose and cause mass NGINX timeouts.
      // Returning 405 is spec-compliant per MCP StreamableHTTP (2025-03-26).
      if (req.method === "GET") {
        return res.status(405).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server does not support GET requests" },
          id: null,
        });
      }

      try {
        const apiKey = extractApiKey(req);
        const resourceUrl = RESOURCE_URL;
        const baseUrl = new URL(resourceUrl).origin;

        // OAuth discovery info header, used by MCP clients to discover the authorization server
        res.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
        );

        if (requireAuth) {
          if (!apiKey) {
            return res.status(401).json({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: "Authentication required. Please authenticate to use this MCP server.",
              },
              id: null,
            });
          }

          if (isJWT(apiKey)) {
            const validationResult = await validateJWT(apiKey);
            if (!validationResult.valid) {
              return res.status(401).json({
                jsonrpc: "2.0",
                error: {
                  code: -32001,
                  message: validationResult.error || "Invalid token. Please re-authenticate.",
                },
                id: null,
              });
            }
          }
        }

        const context: ClientContext = {
          clientIp: getClientIp(req),
          apiKey: apiKey,
          clientInfo: extractClientInfoFromUserAgent(req.headers["user-agent"]),
          transport: "http",
        };

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });

        res.on("close", () => {
          transport.close();
        });

        await requestContext.run(context, async () => {
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
    };

    // Anonymous access endpoint - no authentication required
    app.all("/mcp", async (req, res) => {
      await handleMcpRequest(req, res, false);
    });

    // OAuth-protected endpoint - requires authentication
    app.all("/mcp/oauth", async (req, res) => {
      await handleMcpRequest(req, res, true);
    });

    app.get("/ping", (_req: express.Request, res: express.Response) => {
      res.json({ status: "ok", message: "pong" });
    });

    // OAuth 2.0 Protected Resource Metadata (RFC 9728)
    // Used by MCP clients to discover the authorization server
    app.get(
      "/.well-known/oauth-protected-resource",
      (_req: express.Request, res: express.Response) => {
        res.json({
          resource: RESOURCE_URL,
          authorization_servers: [AUTH_SERVER_URL],
          scopes_supported: ["profile", "email"],
          bearer_methods_supported: ["header"],
        });
      }
    );

    app.get(
      "/.well-known/oauth-authorization-server",
      async (_req: express.Request, res: express.Response) => {
        const authServerUrl = AUTH_SERVER_URL;

        try {
          const response = await fetch(`${authServerUrl}/.well-known/oauth-authorization-server`);
          if (!response.ok) {
            console.error("[OAuth] Upstream error:", response.status);
            return res.status(response.status).json({
              error: "upstream_error",
              message: "Failed to fetch authorization server metadata",
            });
          }
          const metadata = await response.json();
          res.json(metadata);
        } catch (error) {
          console.error("[OAuth] Error fetching OAuth metadata:", error);
          res.status(502).json({
            error: "proxy_error",
            message: "Failed to proxy authorization server metadata",
          });
        }
      }
    );

    // Catch-all 404 handler - must be after all other routes
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({
        error: "not_found",
        message: "Endpoint not found. Use /mcp for MCP protocol communication.",
      });
    });

    const startServer = (port: number, maxAttempts = 10) => {
      const httpServer = app.listen(port);

      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });

      httpServer.once("listening", () => {
        console.error(
          `Context7 Documentation MCP Server v${SERVER_VERSION} running on HTTP at http://localhost:${port}/mcp`
        );
      });
    };

    startServer(initialPort);
  } else {
    stdioApiKey = cliOptions.apiKey || process.env.CONTEXT7_API_KEY;
    const transport = new StdioServerTransport();

    await server.connect(transport);

    console.error(`Context7 Documentation MCP Server v${SERVER_VERSION} running on stdio`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
