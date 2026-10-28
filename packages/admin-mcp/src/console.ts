import type { McpServer } from "@modelcontextprotocol/server";
import { CONSOLE_HTML } from "./ui/console-html.js";

/**
 * The Context7 console as an MCP App (ext-apps spec 2026-01-26): one HTML page
 * that MCP Apps hosts (Claude, ChatGPT, VS Code, Cursor) render in a sandboxed
 * iframe when the model calls `open_console`.
 *
 * The page holds no credential and makes no network request of its own. It
 * reads through `console_data`, an app-only tool that runs one of
 * `CONSOLE_READS`, which the host calls for it with the user's own bearer, so
 * the API's checks apply to the page exactly as they do to the model. That is
 * also why its CSP allows nothing. Every other tool is hidden from the page
 * (`visibility: ["model"]` in server.ts).
 *
 * The page is built from ui/ by `pnpm build:ui` into src/ui/console-html.ts,
 * which is committed: Vercel compiles api/ and src/ and runs no UI build.
 *
 * `openai/ui` is OpenAI's extension (schema in `@openai/mcp-extensions`
 * `shared/ui`): ChatGPT also opens the console from its app sidebar (`global`)
 * and beside a chat (`thread`), where no tool call comes first, so the page
 * then reads the teamspaces itself. The keys are written out by hand, as the
 * Upstash MCP server does: that package peers on MCP SDK v1 and ext-apps 1.x.
 */

export const CONSOLE_URI = "ui://context7/console";

/** The read tools the page uses, through the app-only `console_data` tool (server.ts). */
export const CONSOLE_READS = [
  "list_teamspaces",
  "get_teamspace",
  "get_teamspace_usage",
  "list_libraries",
  "get_library_benchmarks",
  "docs7_list_sites",
  "docs7_get_analytics",
  "docs7_list_deployments",
  "ask_list_sites",
  "ask_get_analytics",
] as const;

/** MCP Apps' MIME type for an app's HTML (`RESOURCE_MIME_TYPE` in ext-apps). */
const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/** `_meta` of the tool that opens the page. `ui/resourceUri` is the older key some hosts still read. */
export const CONSOLE_TOOL_META = {
  ui: { resourceUri: CONSOLE_URI },
  "ui/resourceUri": CONSOLE_URI,
  "openai/ui": {
    entrypoints: [{ type: "global" }, { type: "thread" }],
    preferredModelDisplayMode: "inline",
  },
};

export function registerConsole(server: McpServer): void {
  server.registerResource(
    "context7_console",
    CONSOLE_URI,
    {
      title: "Context7 console",
      description:
        "Usage and spend, libraries and benchmarks, Docs7 and Ask sites of a Context7 teamspace.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: CONSOLE_URI,
          mimeType: MCP_APP_MIME_TYPE,
          text: CONSOLE_HTML,
          _meta: {
            // Every read goes through tools/call, so the page needs no origin at all.
            ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true },
            // No preferredDisplayMode: it would also push model-opened consoles out of the chat.
            "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
          },
        },
      ],
    })
  );
}
