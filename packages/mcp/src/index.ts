#!/usr/bin/env node

import { toNodeHandler } from "@modelcontextprotocol/node";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
  type McpRequestContext,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { searchLibraries, fetchLibraryContext } from "./lib/api.js";
import type { ClientContext } from "./lib/types.js";
import {
  formatSearchResults,
  extractClientInfoFromUserAgent,
  envelopeClientInfo,
} from "./lib/utils.js";
import express from "express";
import { Command, InvalidArgumentError } from "commander";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "node:crypto";
import {
  SERVER_VERSION,
  RESOURCE_URL,
  OAUTH_AUTH_SERVER_URL,
  OPENAI_APPS_CHALLENGE_TOKEN,
  SERVER_ICONS,
  SERVER_TITLE,
  mcpServerCard,
} from "./lib/constants.js";
import { maybeElicitAuthSignIn } from "./lib/auth/auth-prompt.js";
import { QUERY_DOCS_TOOL, RESOLVE_LIBRARY_ID_TOOL } from "./lib/tool-names.js";
import { registerResearchPreviewTools } from "./lib/research-preview-tools.js";
import { installProcessShutdown } from "./lib/process-shutdown.js";
import {
  forceFlushTelemetry,
  initializeTelemetry,
  observeAuthentication,
  observeUpstreamRequest,
  recordAuthenticationEvent,
  recordSelfCancellingBatch,
} from "./lib/telemetry-runtime.js";
import { mcpBodyErrorHandler } from "./lib/mcp-body-error-handler.js";
import {
  observeCredentialedInitialize,
  recordToolCallTelemetry,
} from "./lib/auth-lifecycle-telemetry.js";
import {
  canonicalMcpEndpoint,
  effectiveMcpAuthMode,
  evaluateMcpAuthentication,
  parseMcpAuthMode,
  protectedResourceMetadata,
  protectedResourceUrl,
  setBearerChallenge,
  usableApiKey,
} from "./lib/mcp-http-auth.js";
import { mcpRouteFromUrl } from "./lib/mcp-route.js";
import { parseOAuthAudienceEnforcement } from "./lib/oauth-audience.js";

/** Default HTTP server port */
const DEFAULT_PORT = 3000;
const OAUTH_METADATA_TIMEOUT_MS = 10_000;
const CLAUDE_CODE_PLUGIN = "claude-code-plugin";
const STATIC_LIST_CACHE_HINT = { ttlMs: 3_600_000, cacheScope: "public" } as const;
const PREVIEW_LIST_CACHE_HINT = { ttlMs: 3_600_000, cacheScope: "private" } as const;
type McpInstrumentation = NonNullable<Awaited<ReturnType<typeof initializeTelemetry>>>;
let mcpInstrumentation: McpInstrumentation | undefined;

function getPluginFromRequest(req: express.Request): typeof CLAUDE_CODE_PLUGIN | undefined {
  return req.query.client === CLAUDE_CODE_PLUGIN ? CLAUDE_CODE_PLUGIN : undefined;
}

function isResearchPreviewValue(value: unknown): boolean {
  return value === "1" || value === "true";
}

function researchPreviewFromRequest(request: Request | undefined): boolean {
  return (
    request !== undefined &&
    isResearchPreviewValue(new URL(request.url).searchParams.get("research_preview"))
  );
}

// Parse CLI arguments using commander
const program = new Command()
  .version(SERVER_VERSION, "-v, --version", "output the current version")
  .option("--transport <stdio|http>", "transport type", "stdio")
  .option(
    "--port <number>",
    "port for HTTP transport",
    (value: string) => {
      // 0 is valid and means "let the OS pick", which #3000 made reportable.
      // Everything else is a plain integer inside the TCP port range.
      if (!/^\d+$/.test(value) || Number(value) > 65535) {
        throw new InvalidArgumentError("Must be an integer 0-65535.");
      }
      return Number(value);
    },
    DEFAULT_PORT
  )
  .option("--api-key <key>", "API key for authentication (or set CONTEXT7_API_KEY env var)")
  .option(
    "--research-preview",
    "show experimental tools, stdio only (or set CONTEXT7_RESEARCH_PREVIEW=1 env var)"
  )
  .allowUnknownOption() // let MCP Inspector / other wrappers pass through extra flags
  .parse(process.argv);

const cliOptions = program.opts<{
  transport: string;
  port: number;
  apiKey?: string;
  researchPreview?: boolean;
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
const passedPortFlag = program.getOptionValueSource("port") === "cli";
const passedApiKeyFlag = program.getOptionValueSource("apiKey") === "cli";

if (TRANSPORT_TYPE === "http" && passedApiKeyFlag) {
  console.error(
    "The --api-key flag is not allowed when using --transport http. Use header-based auth at the HTTP layer instead."
  );
  process.exit(1);
}

if (TRANSPORT_TYPE === "http" && cliOptions.researchPreview) {
  console.error(
    "The --research-preview flag is not allowed when using --transport http. Clients add ?research_preview=1 to the MCP URL instead."
  );
  process.exit(1);
}

if (TRANSPORT_TYPE === "stdio" && passedPortFlag) {
  console.error("The --port flag is not allowed when using --transport stdio.");
  process.exit(1);
}

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

// Tool-scoped aliases, for keys that are canonical on one tool but a
// hallucination on another (e.g. `libraryName` is canonical for
// `resolve-library-id`, so we only rewrite it on `query-docs` calls).
const QUERY_DOCS_ALIASES: AliasMap = {
  libraryId: ["context7CompatibleLibraryID", "libraryID", "libraryName"],
};

type JsonRpcId = string | number;

function jsonRpcRequestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object") return undefined;

  const candidate = message as Record<string, unknown>;
  if (
    candidate.jsonrpc === "2.0" &&
    typeof candidate.method === "string" &&
    (typeof candidate.id === "string" || typeof candidate.id === "number")
  ) {
    return candidate.id;
  }
}

function cancellationRequestId(message: unknown): JsonRpcId | undefined {
  if (!message || typeof message !== "object") return undefined;

  const candidate = message as Record<string, unknown>;
  if (
    candidate.jsonrpc !== "2.0" ||
    candidate.method !== "notifications/cancelled" ||
    "id" in candidate ||
    !candidate.params ||
    typeof candidate.params !== "object"
  ) {
    return undefined;
  }

  const requestId = (candidate.params as Record<string, unknown>).requestId;
  if (typeof requestId === "string" || typeof requestId === "number") return requestId;
}

/** True for a 2026-07-28 message: its `params._meta` names a protocol version. */
function hasProtocolVersionClaim(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const params = (message as Record<string, unknown>).params;
  if (!params || typeof params !== "object") return false;
  const meta = (params as Record<string, unknown>)._meta;
  return !!meta && typeof meta === "object" && PROTOCOL_VERSION_META_KEY in meta;
}

function filterBatchSelfCancellations(body: unknown): {
  body: unknown;
  removedSelfCancellation: boolean;
} {
  if (!Array.isArray(body)) return { body, removedSelfCancellation: false };
  // The SDK answers 400 to a batch with a 2026-07-28 element. Leave such a
  // batch whole, so removing a pair cannot hide that element from the SDK.
  if (body.some(hasProtocolVersionClaim)) return { body, removedSelfCancellation: false };

  const requestIds = new Set(body.map(jsonRpcRequestId).filter((id) => id !== undefined));
  const selfCancelledIds = new Set(
    body
      .map(cancellationRequestId)
      .filter((id): id is JsonRpcId => id !== undefined && requestIds.has(id))
  );
  if (selfCancelledIds.size === 0) return { body, removedSelfCancellation: false };

  return {
    body: body.filter((message) => {
      const requestId = jsonRpcRequestId(message);
      if (requestId !== undefined && selfCancelledIds.has(requestId)) return false;

      const cancelledId = cancellationRequestId(message);
      return cancelledId === undefined || !selfCancelledIds.has(cancelledId);
    }),
    removedSelfCancellation: true,
  };
}

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

function createMcpServer(mcpContext: McpRequestContext, researchPreview: boolean) {
  const serverInfo = {
    name: "Context7",
    title: SERVER_TITLE,
    version: SERVER_VERSION,
    websiteUrl: "https://context7.com",
    description:
      "Context7 provides up-to-date documentation and code examples for libraries and frameworks.",
    icons: SERVER_ICONS,
  };
  const serverOptions = {
    // The collections are static for the process lifetime. Explicitly disabling
    // change notifications prevents clients from opening subscriptions/listen
    // streams for events this server never publishes. Declaring prompts and
    // resources still installs their empty list handlers for clients that call
    // them unconditionally.
    capabilities: {
      tools: { listChanged: false },
      prompts: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
    },
    // These results change only on deploy, so clients may reuse them for an
    // hour instead of listing on every request. They are the same for every
    // caller, except tools/list with research preview on: that one is private,
    // so no shared cache gives the preview tools to other callers.
    // After a deploy that changes a tool schema, clients can still call with the
    // old schema for that hour: keep old argument names accepted (aliasArgs).
    cacheHints: {
      "tools/list": researchPreview ? PREVIEW_LIST_CACHE_HINT : STATIC_LIST_CACHE_HINT,
      "prompts/list": STATIC_LIST_CACHE_HINT,
      "resources/list": STATIC_LIST_CACHE_HINT,
      "resources/templates/list": STATIC_LIST_CACHE_HINT,
      "server/discover": STATIC_LIST_CACHE_HINT,
    },
    instructions: `Use this server to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones like React, Next.js, Prisma, Express, Tailwind, Django, or Spring Boot. This includes API syntax, configuration, version migration, porting code between libraries, platforms, or SQL dialects, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer — your training data may not reflect recent changes. Prefer this over web search for library docs.

Do not use for: refactoring, debugging, or reviewing code that does not depend on a library or platform API, or general programming concepts.`,
  };
  const server = mcpInstrumentation
    ? mcpInstrumentation.createServer(serverInfo, serverOptions, mcpContext)
    : new McpServer(serverInfo, serverOptions);

  server.registerTool(
    RESOLVE_LIBRARY_ID_TOOL,
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
        recordToolCallTelemetry(ctx, searchResponse.error ? "error" : "not_found");
        return {
          content: [
            {
              type: "text" as const,
              text,
            },
          ],
          // Same rule as query-docs: an upstream failure is an error, an empty match is not.
          ...(searchResponse.error ? { isError: true } : {}),
        };
      }

      const resultsText = formatSearchResults(searchResponse);
      const responseText = `Available Libraries:\n\n${resultsText}`;
      maybeElicitAuthSignIn(server, ctx);
      recordToolCallTelemetry(ctx, "success");
      return {
        content: [
          {
            type: "text" as const,
            text: responseText,
          },
        ],
      };
    }
  );

  server.registerTool(
    QUERY_DOCS_TOOL,
    {
      title: "Query Documentation",
      description: `Retrieves and queries up-to-date documentation and code examples from Context7 for any programming library or framework.

You must call 'Resolve Context7 Library ID' tool first to obtain the exact Context7-compatible library ID required to use this tool, UNLESS the user explicitly provides a library ID in the format '/org/project' or '/org/project/version' in their query.

Do not call this tool more than 3 times per question.

If you know the programming language the user is working in, pass it as \`language\` so the results match their setup.`,
      inputSchema: z.preprocess(
        aliasArgs({ ...GLOBAL_ALIASES, ...QUERY_DOCS_ALIASES }),
        z.object({
          libraryId: z
            .string()
            .describe(
              "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/supabase/supabase', '/vercel/next.js/v16.2.9') retrieved from 'resolve-library-id' or directly from user query in the format '/org/project' or '/org/project/version'."
            ),
          query: z
            .string()
            .describe(
              "What to look up in the library's documentation, scoped to a single concept. Be specific and include relevant details, but keep each query to one topic — if the user's question spans multiple distinct concepts, make a separate call per concept instead of combining them, unless the question is about how the concepts interact. Good: 'How to set up authentication with JWT in Express.js' or 'React useEffect cleanup function examples'. Bad (too vague): 'auth' or 'hooks'. Bad (too broad): 'routing and auth and caching in Next.js'. The query is sent to the Context7 API for processing. Do not include any sensitive or confidential information such as API keys, passwords, credentials, personal data, or proprietary code in your query."
            ),
          // No length limit here: the API trims long values instead of rejecting the call.
          language: z
            .string()
            .optional()
            .describe(
              "Programming language the user is writing code in, such as 'Python', 'TypeScript', 'Go', or 'C#'. Ranks code examples in that language first. Leave it out when the language is unknown or does not apply."
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
    async (
      { query, libraryId, language }: { query: string; libraryId: string; language?: string },
      toolCtx
    ) => {
      const ctx = getClientContext(toolCtx);
      const response = await fetchLibraryContext({ query, libraryId, language }, ctx);
      maybeElicitAuthSignIn(server, ctx);
      recordToolCallTelemetry(ctx, response.outcome);
      return {
        content: [
          {
            type: "text" as const,
            text: response.data,
          },
        ],
        // Flag failures at the protocol level. Without this an unset `isError`
        // defaults to success, so a caller that branches on `isError` treats an
        // error message (invalid ID, upstream failure) as documentation.
        // "No documentation found" is a valid answer, not an error.
        ...(response.outcome === "error" ? { isError: true } : {}),
      };
    }
  );

  if (researchPreview) registerResearchPreviewTools(server, getClientContext);

  return server;
}

async function main() {
  mcpInstrumentation = await initializeTelemetry({
    allowEmbeddedPrometheus: TRANSPORT_TYPE === "http",
    serviceVersion: SERVER_VERSION,
  });

  if (TRANSPORT_TYPE === "http") {
    // Commander parsed and range-checked this already; 0 means ephemeral.
    const initialPort = cliOptions.port;

    const app = express();
    // Only private/local infrastructure may supply forwarding headers. Express
    // then walks the chain right-to-left and ignores attacker-added prefixes.
    app.set("trust proxy", ["loopback", "linklocal", "uniquelocal", "100.64.0.0/10"]);

    // Node keeps serving requests on kept-alive sockets after server.close(),
    // so during shutdown every response asks the gateway to reconnect elsewhere.
    let shuttingDown = false;
    // Registered ahead of the MCP router so its error responses carry the CORS
    // headers too; browser clients would otherwise see a CORS failure instead
    // of the status.
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (shuttingDown) res.setHeader("Connection", "close");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
      // Mcp-Method / Mcp-Name are the SEP-2243 standard headers 2026-07-28
      // clients send on every request; without them here, browser-based modern
      // clients fail the CORS preflight. (Mcp-Param-* mirroring is skipped by
      // browser clients, so those are not needed.)
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, X-Context7-API-Key, Context7-API-Key, X-API-Key, Authorization, If-None-Match"
      );
      // Browser clients can only read these response headers cross-origin when
      // they are exposed; without WWW-Authenticate they cannot start OAuth
      // from the 401 challenge.
      res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Session-Id");
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

      // Node trims header values, so "Bearer " with an unset key arrives as "Bearer".
      const bearer = /^Bearer(?:\s+(.*))?$/i.exec(header);
      if (bearer) return bearer[1]?.trim() || undefined;

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
    // carrying a request plus its own notifications/cancelled produced exactly
    // that (the 2026-08-11 outage); handleMcpRequest now consumes such pairs
    // before dispatch. Any other silent hang goes idle and the gateway reaps
    // it at streamIdleTimeout (300s) instead of its 1200s hard cap.
    const rawMcpHandler = createMcpHandler(
      (mcpContext) =>
        createMcpServer(mcpContext, researchPreviewFromRequest(mcpContext.requestInfo)),
      {
        keepAliveMs: 0,
        // The SDK reports each 4xx answer to a malformed client request as a new
        // Error whose stack only names SDK internals, so those log
        // their message alone. If the SDK rewords them, the stacks come back.
        onerror: (error) =>
          console.error(
            "MCP handler error:",
            error instanceof Error && /^(Rejected |Unsupported Media Type)/.test(error.message)
              ? error.message
              : error
          ),
      }
    );
    const mcpHandler = mcpInstrumentation
      ? mcpInstrumentation.instrumentHttpHandler(rawMcpHandler)
      : rawMcpHandler;
    // Without onerror, request-conversion / handler.fetch throws are answered
    // with a bare 500 inside the adapter and never reach our express handler.
    const nodeHandler = toNodeHandler(mcpHandler, {
      onerror: (error) => console.error("MCP node adapter error:", error),
    });
    const authMode = parseMcpAuthMode();
    // Read again per token; parsed here so a typo fails startup, not requests.
    parseOAuthAudienceEnforcement();

    const handleMcpRequest = async (req: express.Request, res: express.Response) => {
      try {
        const plugin = getPluginFromRequest(req);
        const apiKey = extractApiKey(req);
        const endpoint = canonicalMcpEndpoint(req);
        const route = mcpRouteFromUrl(endpoint);
        const enforcementMode = effectiveMcpAuthMode(
          authMode,
          endpoint,
          plugin,
          req.headers.authorization
        );
        const authentication = await observeAuthentication({ enforcementMode, route }, () =>
          evaluateMcpAuthentication(apiKey, enforcementMode)
        );

        if (!authentication.allowed) {
          setBearerChallenge(res, endpoint, apiKey ? authentication.error : undefined);
          res.status(401).json({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: authentication.error,
            },
            id: null,
          });
          return;
        }

        // A cancelled request deliberately produces no protocol response, but
        // the SDK's legacy stateless transport still waits for one before it
        // closes the batch's POST stream. Consume request/cancellation pairs
        // that occur in the same batch before SDK dispatch. This applies the
        // cancellation without starting the tool and without leaving an ID in
        // the transport's response accounting. Only POST carries messages;
        // other methods keep the SDK's own method handling (405). A batch that
        // is fully consumed is answered here, before the SDK's Accept check.
        const filteredBody =
          req.method === "POST"
            ? filterBatchSelfCancellations(req.body)
            : { body: req.body, removedSelfCancellation: false };
        if (filteredBody.removedSelfCancellation) {
          recordSelfCancellingBatch(req.headers["user-agent"]);
        }
        if (
          filteredBody.removedSelfCancellation &&
          Array.isArray(filteredBody.body) &&
          filteredBody.body.length === 0
        ) {
          return res.status(202).end();
        }

        const context: ClientContext = {
          clientIp: req.ip,
          apiKey,
          clientInfo: extractClientInfoFromUserAgent(req.headers["user-agent"]),
          mcpAuthMode: enforcementMode,
          mcpEndpoint: endpoint,
          plugin,
          transport: "http",
        };

        observeCredentialedInitialize(res, req.body, {
          enforcementMode,
          method: authentication.method,
          outcome: authentication.outcome,
          route,
        });

        await requestContext.run(context, async () => {
          await nodeHandler(req, res, filteredBody.body);
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
    // Compatibility alias for clients already configured with /mcp/oauth.
    mcpRouter.all("/oauth", (req, res) => handleMcpRequest(req, res));

    // SEP-2127 reserves `{streamable-http-url}/server-card`. Register it
    // before the /mcp router so it is not answered as MCP JSON-RPC.
    app.get("/mcp/server-card", (_req: express.Request, res: express.Response) => {
      res.setHeader("Content-Type", "application/mcp-server-card+json");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Expose-Headers", "ETag");
      // Express adds the ETag and answers a matching If-None-Match with 304.
      res.status(200).send(mcpServerCard());
    });
    app.use("/mcp", mcpRouter);

    app.get("/ping", (_req: express.Request, res: express.Response) => {
      res.json({ status: "ok", message: "pong" });
    });

    // OAuth 2.0 Protected Resource Metadata (RFC 9728)
    // Used by MCP clients to discover the authorization server
    app.get(
      "/.well-known/oauth-protected-resource",
      (_req: express.Request, res: express.Response) => {
        recordAuthenticationEvent({
          enforcementMode: authMode,
          event: "metadata_requested",
          method: "none",
          route: mcpRouteFromUrl(RESOURCE_URL),
        });
        res.json(protectedResourceMetadata(RESOURCE_URL));
      }
    );

    for (const endpoint of ["/mcp", "/mcp/oauth"] as const) {
      app.get(
        `/.well-known/oauth-protected-resource${endpoint}`,
        (_req: express.Request, res: express.Response) => {
          const resource = protectedResourceUrl(endpoint);
          recordAuthenticationEvent({
            enforcementMode: authMode,
            event: "metadata_requested",
            method: "none",
            route: mcpRouteFromUrl(endpoint),
          });
          res.json(protectedResourceMetadata(resource));
        }
      );
    }

    app.get(
      "/.well-known/oauth-authorization-server",
      async (_req: express.Request, res: express.Response) => {
        const authServerUrl = OAUTH_AUTH_SERVER_URL;

        try {
          const abortSignal = AbortSignal.timeout(OAUTH_METADATA_TIMEOUT_MS);
          const upstream = await observeUpstreamRequest(
            "oauth_metadata",
            () =>
              fetch(`${authServerUrl}/.well-known/oauth-authorization-server`, {
                signal: abortSignal,
              }),
            async (response) => {
              if (!response.ok) return { ok: false as const, status: response.status };
              return { ok: true as const, metadata: await response.json() };
            },
            { abortSignal }
          );
          if (!upstream.ok) {
            console.error("[OAuth] Upstream error:", upstream.status);
            return res.status(upstream.status).json({
              error: "upstream_error",
              message: "Failed to fetch authorization server metadata",
            });
          }
          res.json(upstream.metadata);
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

    let activeHttpServer: ReturnType<typeof app.listen> | undefined;
    installProcessShutdown(
      {
        close: async () => {
          shuttingDown = true;
          const server = activeHttpServer;
          // Drain HTTP before closing the MCP handler: requests that still
          // arrive on open sockets would otherwise get a 500 from the closed
          // handler.
          if (server) {
            // A response that began before SIGTERM has no Connection: close, so
            // its socket then idles for keepAliveTimeout (5 s by default) and
            // server.close() waits for it. Node reads the timeout when a socket
            // goes idle, so this also covers responses already running.
            server.keepAliveTimeout = 1_000;
            await new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              server.closeIdleConnections();
            });
          }
          await mcpHandler.close();
        },
      },
      {
        flush: forceFlushTelemetry,
        onerror: (error) => console.error("Failed to close MCP HTTP server:", error),
      }
    );

    const startServer = (port: number, maxAttempts = 10) => {
      const httpServer = app.listen(port);
      activeHttpServer = httpServer;

      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        // Stop at the top of the TCP range: the next listen would be 65536,
        // which throws inside this handler instead of retrying (#3387).
        if (err.code === "EADDRINUSE" && port < 65535 && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });

      httpServer.once("listening", () => {
        const address = httpServer.address();
        if (!address || typeof address === "string") {
          console.error("Failed to determine the bound HTTP port");
          process.exit(1);
        }
        console.error(
          `Context7 Documentation MCP Server v${SERVER_VERSION} running on HTTP at http://localhost:${address.port}/mcp`
        );
      });
    };

    startServer(initialPort);
  } else {
    const keySources = [cliOptions.apiKey, process.env.CONTEXT7_API_KEY];
    stdioApiKey = keySources.map(usableApiKey).find((key) => key !== undefined);
    if (!stdioApiKey && keySources.some((value) => value?.trim())) {
      console.error(
        "The API key is an unset variable placeholder such as ${CONTEXT7_API_KEY}. Running without an API key."
      );
    }
    const researchPreview =
      cliOptions.researchPreview === true ||
      isResearchPreviewValue(process.env.CONTEXT7_RESEARCH_PREVIEW);
    stdioSessionId = randomUUID();
    const rawStdioTransport = new StdioServerTransport();
    const stdioTransport = mcpInstrumentation
      ? mcpInstrumentation.instrumentStdioTransport(rawStdioTransport)
      : rawStdioTransport;

    const stdioHandle = serveStdio(
      (mcpContext) => {
        const server = createMcpServer(mcpContext, researchPreview);

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
        transport: stdioTransport,
        // The SDK's stdio router keeps a subscription that honors nothing open.
        maxSubscriptions: 0,
        onerror: (error) => console.error("MCP stdio error:", error),
      }
    );
    installProcessShutdown(stdioHandle, {
      flush: forceFlushTelemetry,
      input: process.stdin,
      onerror: (error) => console.error("Failed to close MCP stdio server:", error),
    });

    console.error(`Context7 Documentation MCP Server v${SERVER_VERSION} running on stdio`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
