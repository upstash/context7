#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchLibraryContext } from "./lib/api.js";
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

// Store API key globally for stdio mode (where requestContext may not be available in tool handlers)
let globalApiKey: string | undefined;

const stripIpv6Prefix = (ip: string) => ip.replace(/^::ffff:/, "");

const isPrivateIp = (ip: string) =>
  ip.startsWith("10.") || ip.startsWith("192.168.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

function getClientIp(req: express.Request): string | undefined {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ipList = ips.split(",").map((ip) => stripIpv6Prefix(ip.trim()));
    return ipList.find((ip) => !isPrivateIp(ip)) ?? ipList[0];
  }

  return req.socket?.remoteAddress ? stripIpv6Prefix(req.socket.remoteAddress) : undefined;
}

const server = new McpServer(
  {
    name: "Context7",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
    instructions:
      "Use this server to retrieve up-to-date documentation and code examples for any library.",
  }
);

server.registerTool(
  "get-docs",
  {
    title: "Get Library Documentation",
    description: `Retrieves up-to-date documentation and code examples from Context7 for any programming library or framework.

USE THIS TOOL TO:
- Get current, accurate documentation for libraries (e.g., React, Next.js, Express, LangChain)
- Find working code examples and implementation patterns
- Answer "how do I..." questions about specific libraries
- Look up API references, configuration options, and best practices`,
    inputSchema: {
      query: z
        .string()
        .describe(
          "The question or task you need help with. Be specific and include relevant details. Good: 'How to set up authentication with JWT in Express.js' or 'React useEffect cleanup function examples'. Bad: 'auth' or 'hooks'. IMPORTANT: Do not include any sensitive or confidential information such as API keys, passwords, credentials, or personal data in your query."
        ),
      library: z
        .string()
        .optional()
        .describe(
          "Library or framework name (e.g., 'react', 'express') OR exact library ID if provided by the user with or without version (e.g., '/vercel/next.js', '/vercel/next.js@v14.3.0-canary.87'). If omitted, auto-selects based on query."
        ),
      topic: z
        .string()
        .optional()
        .describe(
          "Narrow down results to a specific topic within the library. Examples: 'hooks', 'routing', 'middleware', 'authentication', 'state management'."
        ),
      mode: z
        .enum(["code", "info"])
        .optional()
        .default("code")
        .describe(
          "Type of content to prioritize. Use 'code' (default) when you need working code examples, API usage patterns, and implementation snippets. Use 'info' when you need conceptual narrative explanations, architectural overviews, or understanding how something works."
        ),
    },
  },
  async ({ query, library, topic, mode = "code" }) => {
    const ctx = requestContext.getStore();
    const apiKey = ctx?.apiKey || globalApiKey;

    const response = await fetchLibraryContext(
      { query, library, topic, mode },
      ctx?.clientIp,
      apiKey
    );

    return {
      content: [
        {
          type: "text",
          text: response.data,
        },
      ],
    };
  }
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
        extractHeaderValue(req.headers["x-api-key"])
      );
    };

    app.all("/mcp", async (req: express.Request, res: express.Response) => {
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
          `Context7 Documentation MCP Server running on HTTP at http://localhost:${port}/mcp`
        );
      });
    };

    startServer(initialPort);
  } else {
    const apiKey = cliOptions.apiKey || process.env.CONTEXT7_API_KEY;
    globalApiKey = apiKey; // Store globally for tool handlers in stdio mode
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
