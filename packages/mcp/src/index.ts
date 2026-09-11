#!/usr/bin/env node

import { toNodeHandler } from "@modelcontextprotocol/node";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { McpServer, createMcpHandler, type ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { searchLibraries, fetchLibraryContext, fetchAutoLibraryContext } from "./lib/api.js";
import type { ClientContext } from "./lib/types.js";
import {
  formatSearchResults,
  extractClientInfoFromUserAgent,
  envelopeClientInfo,
} from "./lib/utils.js";
import { isJWT, validateJWT } from "./lib/jwt.js";
import express from "express";
import { Command } from "commander";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "node:crypto";
import {
  SERVER_VERSION,
  RESOURCE_URL,
  OAUTH_AUTH_SERVER_URL,
  EMA_ISSUER,
  OPENAI_APPS_CHALLENGE_TOKEN,
} from "./lib/constants.js";
import { maybeElicitAuthSignIn } from "./lib/auth/auth-prompt.js";
import { getMaxSubscriptions } from "./lib/subscriptions.js";
import { mcpBodyErrorHandler } from "./lib/mcp-body-error-handler.js";

/** Default HTTP server port */
const DEFAULT_PORT = 3000;
const CLAUDE_CODE_PLUGIN = "claude-code-plugin";

function getPluginFromRequest(req: express.Request): typeof CLAUDE_CODE_PLUGIN | undefined {
  return req.query.client === CLAUDE_CODE_PLUGIN ? CLAUDE_CODE_PLUGIN : undefined;
}

function requiresAuthentication(req: express.Request, plugin?: typeof CLAUDE_CODE_PLUGIN): boolean {
  // The MCP routes live on a router mounted at /mcp, so req.path is relative to it.
  return `${req.baseUrl}${req.path}` === "/mcp/oauth" || Boolean(plugin);
}

// Parse CLI arguments using commander
const program = new Command()
  .version(SERVER_VERSION, "-v, --version", "output the current version")
  .option("--transport <stdio|http>", "transport type", "stdio")
  .option("--port <number>", "port for HTTP transport", DEFAULT_PORT.toString())
  .option("--api-key <key>", "API key for authentication (or set CONTEXT7_API_KEY env var)")
  .option(
    "--tool-mode <two-step|single>",
    "MCP tool surface (experimental)",
    process.env.CONTEXT7_MCP_TOOL_MODE || "two-step"
  )
  .allowUnknownOption() // let MCP Inspector / other wrappers pass through extra flags
  .parse(process.argv);

const cliOptions = program.opts<{
  transport: string;
  port: string;
  apiKey?: string;
  toolMode: string;
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

const allowedToolModes = ["two-step", "single"] as const;
if (!allowedToolModes.includes(cliOptions.toolMode as (typeof allowedToolModes)[number])) {
  console.error(
    `Invalid --tool-mode value: '${cliOptions.toolMode}'. Must be one of: ${allowedToolModes.join(", ")}`
  );
  process.exit(1);
}
const TOOL_MODE = cliOptions.toolMode as (typeof allowedToolModes)[number];

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
// One session ID per stdio process.
let stdioSessionId: string | undefined;

/**
 * Get the effective client context
 */
function getClientContext(toolCtx: ServerContext): ClientContext {
  const ctx = requestContext.getStore();
  const requestClientInfo = envelopeClientInfo(toolCtx.mcpReq.envelope);

  // Use protocol client info when available; fall back to the HTTP User-Agent.
  if (ctx) {
    return { ...ctx, clientInfo: requestClientInfo ?? ctx.clientInfo };
  }

  // stdio mode: envelope (modern clients) or globals (legacy initialize)
  return {
    apiKey: stdioApiKey,
    clientInfo: requestClientInfo ?? stdioClientInfo,
    transport: "stdio",
    sessionId: stdioSessionId,
  };
}

// Map of canonical arg name -> hallucinated aliases that should be rewritten
// to it. LLM clients often echo phrasing from tool descriptions instead of
// the literal schema keys, which trips Zod validation before the tool runs.
type AliasMap = Record<string, readonly string[]>;

const GLOBAL_ALIASES: AliasMap = {
  query: ["userQuery", "question"],
};

const AUTO_QUERY_ALIASES: AliasMap = {
  ...GLOBAL_ALIASES,
  library: ["libraryName", "repository", "domain"],
  libraryId: ["context7CompatibleLibraryID", "libraryID"],
};

// Tool-scoped aliases, for keys that are canonical on one tool but a
// hallucination on another (e.g. `libraryName` is canonical for
// `resolve-library-id`, so we only rewrite it on `query-docs` calls).
const QUERY_DOCS_ALIASES: AliasMap = {
  libraryId: ["context7CompatibleLibraryID", "libraryID", "libraryName"],
};

// z.preprocess step that rewrites aliased arg names before validation. Living
// in the schema keeps aliasing transport-agnostic: the SDK parses the wire
// message (any transport, any protocol era) and runs this on validation.
// Returns a remapped copy — the raw wire params object stays untouched.
function aliasArgs(aliases: AliasMap) {
  return (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const args: Record<string, unknown> = { ...value };
    for (const [canonical, alternatives] of Object.entries(aliases)) {
      if (canonical in args) continue;
      for (const alt of alternatives) {
        if (alt in args) {
          args[canonical] = args[alt];
          delete args[alt];
          break;
        }
      }
    }
    return args;
  };
}

function normalizeAutoQueryArgs(value: unknown) {
  const aliased = aliasArgs(AUTO_QUERY_ALIASES)(value);
  if (!aliased || typeof aliased !== "object") return aliased;
  const args: Record<string, unknown> = { ...aliased };
  if (typeof args.library === "string" && !("libraries" in args)) {
    args.libraries = [args.library];
  }
  if (typeof args.libraryId === "string" && !("libraryIds" in args)) {
    args.libraryIds = [args.libraryId];
  }
  delete args.library;
  delete args.libraryId;
  return args;
}

function createMcpServer() {
  const server = new McpServer(
    {
      name: "Context7",
      version: SERVER_VERSION,
      websiteUrl: "https://context7.com",
      description:
        "Context7 provides up-to-date documentation and code examples for libraries and frameworks.",
      icons: [
        {
          src: "https://context7.com/context7-icon-green.png",
          mimeType: "image/png",
        },
      ],
    },
    {
      // Declaring the capabilities makes the SDK install prompts/list,
      // resources/list, and resources/templates/list handlers that answer
      // with the registered (i.e. empty) collections, for clients that
      // request them unconditionally.
      capabilities: { prompts: {}, resources: {} },
      instructions: `Use this server to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.`,
    }
  );

  if (TOOL_MODE === "single") {
    server.registerTool(
      "query-docs",
      {
        title: "Query Documentation",
        description: `Retrieves up-to-date documentation and code examples for a natural-language implementation question in one call.

Context7 selects up to four relevant documentation libraries, searches their namespaces in parallel, deduplicates the evidence, and reranks the combined snippets. Explicit Context7 IDs are used directly within the response safety cap.

Make one initial call per user question. For comparisons, integrations, and migrations, keep every named product in that one complete query and put every user-supplied product name in libraries; omitting one product is incorrect. Never fan one question out into parallel query-docs calls. Put the complete question in query, including product names, versions, languages, and all concepts needed to answer. Optional library/libraries and version fields are routing hints only; do not guess a Context7 library ID.

Retry policy: when a failure explicitly says it is transient/retryable, retry the same request at most once later. For a non-retryable documentation miss, never repeat the identical request. Make at most one refined call only when you can add genuinely new routing information from the user, such as an explicit library name, Context7 ID, version, or a materially more specific question. Do not retry a successful response.`,
        inputSchema: z.preprocess(
          normalizeAutoQueryArgs,
          z
            .object({
              query: z
                .string()
                .describe(
                  "The user's complete implementation question, including every named library or product, version, language, and all requested concepts. For comparisons, integrations, and migrations, every product must remain here and in libraries; omitting one is incorrect. Make one tool call. Do not shorten or split it. Do not include secrets, personal data, or proprietary code."
                ),
              libraries: z
                .array(z.string().min(1).max(120))
                .min(1)
                .max(4)
                .optional()
                .describe(
                  "Fuzzy product names supplied by the user. When the question names two or more products for a comparison, integration, or migration, include every named product here and keep all of them in query. Make only one tool call."
                ),
              libraryIds: z
                .array(
                  z.string().regex(/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[\/@][A-Za-z0-9_.-]+)?$/)
                )
                .min(1)
                .max(4)
                .optional()
                .describe(
                  "Optional exact Context7 IDs supplied by the user or trusted sources for one multi-library question. Never guess these values."
                ),
              version: z
                .string()
                .regex(/^v?\d+(?:[._]\d+){0,2}(?:[-+][a-z0-9.-]+)?$/i)
                .optional()
                .describe(
                  "Optional version supplied by the user. It may accompany one or more fuzzy library names, but at most one exact libraryId. For fuzzy names it is retrieval context, so include the complete version-qualified product wording in query."
                ),
            })
            .superRefine((value, context) => {
              const fuzzyHintCount = value.libraries?.length ?? 0;
              const exactHintCount = value.libraryIds?.length ?? 0;
              if (fuzzyHintCount > 0 && exactHintCount > 0) {
                context.addIssue({
                  code: "custom",
                  message: "Use library names or library IDs, not both",
                });
              }
              if (value.version && fuzzyHintCount + exactHintCount === 0) {
                context.addIssue({
                  code: "custom",
                  message: "Version requires a library or libraryId hint",
                });
              }
              if (value.version && exactHintCount > 1) {
                context.addIssue({
                  code: "custom",
                  message: "Version can accompany at most one exact libraryId",
                });
              }
            })
        ),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
          idempotentHint: true,
        },
      },
      async (
        {
          query,
          libraries,
          libraryIds,
          version,
        }: {
          query: string;
          libraries?: string[];
          libraryIds?: string[];
          version?: string;
        },
        toolCtx
      ) => {
        const ctx = getClientContext(toolCtx);
        const response = await fetchAutoLibraryContext(query, ctx, {
          libraries,
          libraryIds,
          version,
        });
        maybeElicitAuthSignIn(server, ctx);
        const selectedLibraries = response.libraryIds?.length
          ? `Selected ${response.libraryIds.length === 1 ? "library" : "libraries"}: ${response.libraryIds.join(", ")}\n\n`
          : "";
        const retryGuidance = response.error
          ? response.retryable
            ? "\n\nThis was a transient search failure. Retry the same request later."
            : `\n\nDo not repeat the identical request. ${
                response.retryReason === "no-relevant-documentation"
                  ? "Refine the question or add a library hint."
                  : "Check the library or version hint."
              }`
          : "";
        return {
          isError: response.retryable === true,
          content: [
            {
              type: "text",
              text: `${selectedLibraries}${response.data}${retryGuidance}`,
            },
          ],
        };
      }
    );

    return server;
  }

  server.registerTool(
    "resolve-library-id",
    {
      title: "Resolve Context7 Library ID",
      description: `Resolves a package/product name to a Context7-compatible library ID and returns matching libraries.

You MUST call this function before 'Query Documentation' tool to obtain a valid Context7-compatible library ID UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Each result includes:
- Library ID: Context7-compatible identifier (format: /org/project)
- Name: Library or package name
- Description: Short summary
- Code Snippets: Number of available code examples
- Source Reputation: Authority indicator (High, Medium, Low, or Unknown)
- Benchmark Score: Quality indicator (100 is the highest score)
- Versions: List of versions if available. Use one of those versions if the user provides a version in their query. The format of the version is /org/project/version.

For best results, select libraries based on name match, source reputation, snippet coverage, benchmark score, and relevance to your use case.

Selection Process:
1. Analyze the query to understand what library/package the user is looking for
2. Return the most relevant match based on:
- Name similarity to the query (exact matches prioritized)
- Description relevance to the query's intent
- Documentation coverage (prioritize libraries with higher Code Snippet counts)
- Source reputation (consider libraries with High or Medium reputation more authoritative)
- Benchmark Score: Quality indicator (100 is the highest score)

Response Format:
- Return the selected library ID in a clearly marked section
- Provide a brief explanation for why this library was chosen
- If multiple good matches exist, acknowledge this but proceed with the most relevant one
- If no good matches exist, clearly state this and suggest query refinements

For ambiguous queries, request clarification before proceeding with a best-guess match.

IMPORTANT: Do not call this tool more than 3 times per question. If you cannot find what you need after 3 calls, use the best result you have.`,
      inputSchema: z.preprocess(
        aliasArgs(GLOBAL_ALIASES),
        z.object({
          query: z
            .string()
            .describe(
              "What to look up in the library's documentation. This is used to rank library results by relevance to what the user is trying to accomplish. The query is sent to the Context7 API for processing. Do not include any sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code in your query."
            ),
          libraryName: z
            .string()
            .describe(
              "Library name to search for and retrieve a Context7-compatible library ID. Use the official library name with proper punctuation — e.g., 'Next.js' instead of 'nextjs', 'Customer.io' instead of 'customerio', 'Three.js' instead of 'threejs'."
            ),
        })
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, libraryName }: { query: string; libraryName: string }, toolCtx) => {
      const ctx = getClientContext(toolCtx);
      const searchResponse = await searchLibraries(query, libraryName, ctx);

      if (!searchResponse.results || searchResponse.results.length === 0) {
        const text = searchResponse.error ?? "No libraries found matching the provided name.";
        maybeElicitAuthSignIn(server, ctx);
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      }

      const resultsText = formatSearchResults(searchResponse);
      const responseText = `Available Libraries:\n\n${resultsText}`;
      maybeElicitAuthSignIn(server, ctx);
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
    "query-docs",
    {
      title: "Query Documentation",
      description: `Retrieves and queries up-to-date documentation and code examples from Context7 for any programming library or framework.

You must call 'Resolve Context7 Library ID' tool first to obtain the exact Context7-compatible library ID required to use this tool, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Do not call this tool more than 3 times per question.`,
      inputSchema: z.preprocess(
        aliasArgs({ ...GLOBAL_ALIASES, ...QUERY_DOCS_ALIASES }),
        z.object({
          libraryId: z
            .string()
            .describe(
              "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v14.3.0-canary.87') retrieved from 'resolve-library-id' or directly from user query in the format '/org/project' or '/org/project/version'."
            ),
          query: z
            .string()
            .describe(
              "What to look up in the library's documentation, scoped to a single concept. Be specific and include relevant details, but keep each query to one topic — if the user's question spans multiple distinct concepts, make a separate call per concept instead of combining them, unless the question is about how the concepts interact. Good: 'How to set up authentication with JWT in Express.js' or 'React useEffect cleanup function examples'. Bad (too vague): 'auth' or 'hooks'. Bad (too broad): 'routing and auth and caching in Next.js'. The query is sent to the Context7 API for processing. Do not include any sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code in your query."
            ),
        })
      ),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
    },
    async ({ query, libraryId }: { query: string; libraryId: string }, toolCtx) => {
      const ctx = getClientContext(toolCtx);
      const response = await fetchLibraryContext({ query, libraryId }, ctx);
      maybeElicitAuthSignIn(server, ctx);
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

  return server;
}

async function main() {
  if (TRANSPORT_TYPE === "http") {
    const initialPort = CLI_PORT ?? DEFAULT_PORT;

    const app = express();
    // Only private/local infrastructure may supply forwarding headers. Express
    // then walks the chain right-to-left and ignores attacker-added prefixes.
    app.set("trust proxy", ["loopback", "linklocal", "uniquelocal", "100.64.0.0/10"]);

    // Registered ahead of the MCP router so its error responses carry the CORS
    // headers too; browser clients would otherwise see a CORS failure instead
    // of the status.
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
      // Mcp-Method / Mcp-Name are the SEP-2243 standard headers 2026-07-28
      // clients send on every request; without them here, browser-based modern
      // clients fail the CORS preflight. (Mcp-Param-* mirroring is skipped by
      // browser clients, so those are not needed.)
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization"
      );
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
        extractHeaderValue(req.headers["x-context7-api-key"]) ||
        extractHeaderValue(req.headers["context7-api-key"]) ||
        extractHeaderValue(req.headers["x-api-key"]) ||
        extractHeaderValue(req.headers["context7_api_key"]) ||
        extractHeaderValue(req.headers["x_api_key"])
      );
    };

    // Stateless serving: a fresh server instance per request, no Mcp-Session-Id,
    // no session store. The handler serves modern (2026-07-28) traffic natively
    // and 2025-era traffic through its stateless legacy fallback, which answers
    // GET/DELETE (session operations) with 405.
    // keepAliveMs: 0 disables SSE keepalive heartbeats. Every tool here is a
    // millisecond vector query (p100 ~28s), so no legitimate exchange needs a
    // heartbeat to stay alive — but a hung exchange kept "alive" by heartbeats
    // can never be reaped by the gateway's stream idle timeout. A batch
    // carrying a request plus its own notifications/cancelled produces exactly
    // that: per spec the cancelled request gets no response, the SDK transport
    // then never closes the stream, and with heartbeats it survived until the
    // gateway's 1200s hard cap (the 2026-08-11 outage). Silent hangs instead
    // go idle and the gateway reaps them at streamIdleTimeout (300s).
    const mcpHandler = createMcpHandler(() => createMcpServer(), {
      keepAliveMs: 0,
      maxSubscriptions: getMaxSubscriptions(),
      onerror: (error) => console.error("MCP handler error:", error),
    });
    // Without onerror, request-conversion / handler.fetch throws are answered
    // with a bare 500 inside the adapter and never reach our express handler.
    const nodeHandler = toNodeHandler(mcpHandler, {
      onerror: (error) => console.error("MCP node adapter error:", error),
    });

    const handleMcpRequest = async (req: express.Request, res: express.Response) => {
      try {
        const plugin = getPluginFromRequest(req);
        const apiKey = extractApiKey(req);
        const baseUrl = new URL(RESOURCE_URL).origin;

        // OAuth discovery info header, used by MCP clients to discover the authorization server
        // TODO: @modelcontextprotocol/server now ships canonical OAuth helpers
        // (bearerAuthChallengeResponse, buildOAuthProtectedResourceMetadata,
        // oauthMetadataResponse) — replace this hand-rolled header and the
        // /.well-known/oauth-protected-resource route with them.
        res.set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
        );

        if (requiresAuthentication(req, plugin)) {
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
          clientIp: req.ip,
          apiKey,
          clientInfo: extractClientInfoFromUserAgent(req.headers["user-agent"]),
          plugin,
          transport: "http",
        };

        await requestContext.run(context, async () => {
          await nodeHandler(req, res, req.body);
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

    // JSON bodies and JSON-RPC error envelopes are the MCP contract only, so the
    // parser and its error boundary live on the MCP router: every other route
    // stays out of the parser and keeps its own response shape.
    const mcpRouter = express.Router();
    mcpRouter.use(express.json());
    mcpRouter.use(mcpBodyErrorHandler);
    mcpRouter.all("/", (req, res) => handleMcpRequest(req, res));
    // OAuth-protected endpoint - requires authentication
    mcpRouter.all("/oauth", (req, res) => handleMcpRequest(req, res));
    app.use("/mcp", mcpRouter);

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
          // Each entry is an independent authorization server. Clerk handles
          // regular authorization-code flows; Context7 handles only the
          // enterprise-managed id-jag exchange.
          authorization_servers: Array.from(new Set([OAUTH_AUTH_SERVER_URL, EMA_ISSUER])),
          scopes_supported: ["profile", "email"],
          bearer_methods_supported: ["header"],
        });
      }
    );

    app.get(
      "/.well-known/oauth-authorization-server",
      async (_req: express.Request, res: express.Response) => {
        const authServerUrl = OAUTH_AUTH_SERVER_URL;

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

    // OpenAI Apps SDK domain verification challenge
    app.get(
      "/.well-known/openai-apps-challenge",
      (_req: express.Request, res: express.Response) => {
        if (!OPENAI_APPS_CHALLENGE_TOKEN) {
          return res.status(404).json({
            error: "not_found",
            message: "Endpoint not found.",
          });
        }
        res.type("text/plain").send(OPENAI_APPS_CHALLENGE_TOKEN);
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
    stdioSessionId = randomUUID();

    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("close", () => process.exit(0));
    process.on("SIGHUP", () => process.exit(0));

    serveStdio(
      () => {
        const server = createMcpServer();

        // Capture client info from MCP initialize handshake (stdio only — HTTP
        // mode plumbs client info through requestContext per request).
        server.server.oninitialized = () => {
          const clientVersion = server.server.getClientVersion();
          if (clientVersion) {
            stdioClientInfo = {
              ide: clientVersion.name,
              version: clientVersion.version,
            };
          }
        };

        return server;
      },
      {
        onerror: (error) => console.error("MCP stdio error:", error),
      }
    );

    console.error(`Context7 Documentation MCP Server v${SERVER_VERSION} running on stdio`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
