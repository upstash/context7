# @upstash/context7-mcp

## 3.2.2

### Patch Changes

- 2253765: Validate Enterprise-Managed Auth (id-jag) access tokens at the MCP server, so MCP clients can authenticate to Context7 through an enterprise IdP (Okta) via the MCP Enterprise-Managed Authorization extension.

## 3.2.1

### Patch Changes

- 8123b51: Restore Node 18 support by pinning undici to ^6.26.0 and commander to ^13.1.0, which dropped the Node 20+ engine requirements that caused a "File is not defined" crash on startup.

## 3.2.0

### Minor Changes

- c921c8b: Replace the in-result sign-in nudge with an MCP form elicitation. When the backend signals (via `X-Context7-Auth-Prompt: 1`) that an anonymous client has crossed the per-IP threshold, the MCP server now fires an `elicitation/create` request instead of appending instructions into the tool result.
  - Surfaces the `npx ctx7 setup --<client> --mcp[ --stdio] -y` command in a client-rendered dialog rather than as model-visible text. The previous text-injection approach was treated as untrusted instruction content by some agents; elicitations are delivered out-of-band to the user so they bypass that path entirely.
  - Gated on the client advertising the `elicitation` capability — clients without it see no nudge, which is a safe no-op.
  - Presents a two-option radio: "I'll run the command to sign in" or "Continue anonymously with smaller limits".
  - The server holds no suppression state: the backend emits the header at most once per MCP session, so the dialog is shown whenever the header is present. Frequency is owned entirely by the backend.
  - Fire-and-forget: the elicitation does not block or alter the surrounding tool response.

### Patch Changes

- cb6aee1: Bump runtime dependencies: `@modelcontextprotocol/sdk` 1.25 -> 1.29, `undici` 6 -> 7, and `zod` 4.3 -> 4.4.
- fcdc36e: Advertise empty `prompts` and `resources` capabilities with no-op `prompts/list`, `resources/list`, and `resources/templates/list` handlers. Some MCP clients (e.g. opencode) call these unconditionally and treat `-32601 Method not found` as a fatal connection error rather than honoring the negotiated capabilities, which previously prevented the server from loading.

## 3.1.0

### Minor Changes

- 1fb2d42: Add multi-tenant Microsoft Entra ID validation for MCP tokens. The server now detects inbound Entra v2 tokens by issuer pattern, fetches per-teamspace configuration (`tenantId`, `audience`, `requiredScope`) from the Context7 app, and verifies the token against the matching tenant's JWKS, enforcing the required scope claim when configured. User resolution happens downstream in the Context7 app against a pre-provisioned user mapping table — the MCP server only validates. Per-tenant JWKS cache and a 5-minute in-memory config cache keyed by JWT audience reduce overhead under load.

## 3.0.0

### Major Changes

- af6a7b5: Convert the stateless MCP implementation to a stateful one using Redis for session management.

### Patch Changes

- 3d73145: Reduce Redis writes on `refresh` by checking the remaining TTL first and only issuing `EXPIRE` when the session is within one day of expiry.

## 2.3.0

### Minor Changes

- 34fda7d: Prompt anonymous users to sign in. After the backend signals (via the `X-Context7-Auth-Prompt: 1` response header on `/v2/libs/search` or `/v2/context`) that an anonymous client has crossed the per-IP threshold, the MCP server appends a one-time sign-in invitation to the tool result.
  - Both **stdio** and **HTTP** transports surface the same nudge: a tool-result notice asking the assistant to run `npx ctx7 setup --<client> --mcp -y` (with `--stdio` appended when the MCP server is running on stdio) after explicit user confirmation. The CLI handles OAuth and writes credentials into the MCP client's config; the user restarts their MCP server / editor to pick up the new credentials.
  - Detects the calling client from `X-Context7-Client-IDE` / User-Agent and selects the matching CLI flag (`--cursor`, `--claude`, `--codex`, `--opencode`, `--gemini`); falls back to interactive setup when unknown.
  - HTTP transport remains stateless — the threshold is tracked by the backend (per-IP, 24h TTL), the MCP server only reacts to the signal.

## 2.2.5

### Patch Changes

- 187287c: Accept hallucinated argument names on `tools/call` requests by rewriting them to the canonical names before validation. `userQuery` and `question` are mapped to `query` on either tool; on `query-docs`, `context7CompatibleLibraryID`, `libraryID`, and `libraryName` are mapped to `libraryId`. Some LLM clients produce these alternative names — likely echoing phrasing from each tool's description — and previously triggered `Invalid input: expected string, received undefined` errors. `libraryName` is only rewritten on `query-docs` calls because it is the canonical arg for `resolve-library-id`. Tool input schemas published via `tools/list` are unchanged: canonical names remain the documented required fields, the rewrite is purely a server-side compatibility shim that runs only on `tools/call` and only when the canonical key is absent.
- 78b9826: Exit the stdio MCP server when the parent process closes its stdio. Previously, if the parent (e.g. Claude Code) was force-killed shortly after a tool call, an idle undici keep-alive socket to the Context7 API would keep libuv's event loop alive past stdin EOF, leaving an orphaned `node` process that consumed memory until the kernel tore the socket down (which on Cloudflare-fronted endpoints can take hours). The server now listens for `end`/`close` on stdin and `SIGHUP` and exits cleanly. Fixes #2542.

## 2.2.4

### Patch Changes

- d0e4a48: Create a fresh `McpServer` per HTTP request. Sharing one across requests let any concurrent `transport.close` clear the shared `Protocol._transport`, which broke `sendNotification` for in-flight long-running tool calls.
- 1aa3430: Remove research mode entirely from the MCP server and CLI. The `query-docs` MCP tool no longer accepts or forwards a `researchMode` parameter, and the CLI no longer exposes a `--research` flag on `ctx7 docs`.

## 2.2.3

### Patch Changes

- 772da3a: Stream MCP tool responses over SSE so HTTP headers flush before client `fetch` timeouts. Switching `enableJsonResponse` to `false` makes the SDK return the HTTP response synchronously after request validation, so headers are sent in milliseconds instead of being buffered until the tool completes. This fixes clients that cap the underlying `fetch` waiting for headers (e.g., Claude Code's 60s `wrapFetchWithTimeout`).

## 2.2.2

### Patch Changes

- 8274bd0: Add missing tool annotations
- ff6c1be: Remove the `researchMode` parameter from the `query-docs` tool's input schema. The underlying API still supports research mode, but several MCP clients hit per-request timeouts (60s defaults) on long-running research calls in ways that can't always be solved server-side. Hiding the parameter prevents agents from invoking it through MCP until the timeout story is reliable across clients.

## 2.2.1

### Patch Changes

- 1b0c211: Add endpoint for OpenAI Apps SDK domain verification.

## 2.2.0

### Minor Changes

- 17b864f: Expose research mode through the MCP `researchMode` tool and the CLI `docs --research` flag for deep, agent-driven documentation answers.

## 2.1.8

### Patch Changes

- 00833f9: Preserve Node's default trusted CAs when `NODE_EXTRA_CA_CERTS` is configured, and add a regression test for custom CA loading.

## 2.1.7

### Patch Changes

- 658ec67: Add --version/-v flag to MCP CLI
- 8322879: Improve resolve libryar id tool prompt to provide the libraryName query with proper format

## 2.1.6

### Patch Changes

- a667712: Update search filter warning
- be1a39a: Update server metadata and instructions.

## 2.1.5

### Patch Changes

- 2070cb1: Support NODE_EXTRA_CA_CERTS for enterprise MITM proxies by injecting custom CA certificates into undici's global dispatcher at runtime

## 2.1.4

### Patch Changes

- 9de3f06: Display warning when public library access filter is being used to filter libraries.

## 2.1.3

### Patch Changes

- 9523522: Reject GET requests on MCP endpoints with 405 to eliminate idle SSE connection timeouts
- 59d0327: Include source field in search result response

## 2.1.2

### Patch Changes

- 617d8ed: Remove unnecessary warning and update tool descriptions

## 2.1.1

### Patch Changes

- 02148ff: Bump zod from 3.x to 4.x

## 2.1.0

### Minor Changes

- ef82f30: Add OAuth 2.0 authentication support for MCP server
  - Add new `/mcp/oauth` endpoint requiring JWT authentication
  - Implement JWT validation against authorization server JWKS
  - Add OAuth Protected Resource Metadata endpoint (RFC 9728) at `/.well-known/oauth-protected-resource`
  - Include `WWW-Authenticate` header for OAuth discovery

## 2.0.2

### Patch Changes

- 368b143: Collect client and server version metrics

## 2.0.1

### Patch Changes

- 93a2d5b: Adds MCP tool annotations (readOnlyHint) to all tools to help MCP clients better understand tool behavior and make safer decisions about tool execution.

## 2.0.0

### Major Changes

- 66ea0d6: Upgrade MCP server to v2.0.0 with intelligent query-based architecture

  Breaking Changes
  - Removed get-library-docs tool, replaced with new query-docs tool
  - resolve-library-id now requires both query and libraryName parameters
  - Removed mode, topic, page, and limit parameters from documentation fetching
  - Renamed context7CompatibleLibraryID parameter to libraryId

  New Features
  - Intelligent reranked and deduplicated library selection based on user intent
  - Smart snippet selection with relevance-based ranking for documentation retrieval
  - Query-driven context fetching that understands what the user is trying to accomplish
  - Added security warnings for sensitive data in query parameters
  - Added tool call limits (max 3 calls per question) to prevent excessive context window usage

  Improvements
  - Simplified API key header extraction (removed redundant case variants)
  - Removed unused actualPort variable and dead code
  - Cleaner type definitions with new ContextRequest and ContextResponse types
  - Better error messages for library search failures

## 1.0.33

### Patch Changes

- a5228fd: Fix API key not being passed in resolve-library-id tool when using stdio transport

## 1.0.32

### Patch Changes

- ad23996: Remove masked API key display from unauthorized error responses
- aa12390: Improve error message handling by using the responses from the server.

## 1.0.31

### Patch Changes

- 6255e26: Migrate to pnpm monorepo structure
