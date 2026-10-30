# Context7 Admin MCP

A remote MCP server to manage Context7 from an agent: teamspace members, libraries, rules and policies, usage, Docs7 sites and Ask sites. Each tool calls the Context7 management API (`https://context7.com/api/v2/teamspaces/...`) with your credential.

For documentation lookup, use the [Context7 MCP server](../mcp) instead.

## Connect

URL: `https://admin.mcp.context7.com/mcp`

```json
{
  "mcpServers": {
    "context7-admin": {
      "type": "http",
      "url": "https://admin.mcp.context7.com/mcp"
    }
  }
}
```

### OAuth

Clients that support MCP OAuth sign in on the first request. The server answers `401` with `WWW-Authenticate: Bearer resource_metadata="https://admin.mcp.context7.com/.well-known/oauth-protected-resource/mcp"`, and the client signs in with your Context7 account. When the token expires or the API rejects it, the server answers `401` again and the client signs in again.

### API key (CI and scripts)

Create a Context7 API key in [the dashboard](https://context7.com/dashboard) and send it as a bearer. Every key can read; turn on **Write access** when you create the key to also make changes (a key without it gets 403 on changes). A key reaches only its own teamspace.

```json
{
  "mcpServers": {
    "context7-admin": {
      "type": "http",
      "url": "https://admin.mcp.context7.com/mcp",
      "headers": { "Authorization": "Bearer ctx7sk-..." }
    }
  }
}
```

## Teamspaces and sites

One OAuth connection reaches every teamspace you are a member of, with your role in each.

- Each tool takes `teamspace`: an id or a name. Leave it out when you have one teamspace. With several, the agent can work on many in one session by passing a different `teamspace` on each call.
- Docs7 and Ask sites belong to a teamspace. `docs7_list_sites` and `ask_list_sites` give their ids; every site tool takes `site_id` (Docs7) or `site_key` (Ask).
- An API key belongs to one teamspace: the API refuses the others. Use one key (and one server entry) per teamspace.
- To limit what an agent can do (read only, some tools only), use your client's tool settings: Claude connectors and Claude Code permissions can turn each tool off or make it ask first.

## Tools

- `teamspace` takes an id or a name. Leave it out when you have one teamspace; with several, the error lists them.
- Library ids take `/owner/repo`, `owner/repo` or a context7.com library URL.
- Long jobs (library parse, Docs7 build, Ask crawl): call `get_library`, `docs7_get_deployment` or `ask_get_site` with `wait: true`. The server waits up to about 25 seconds for a final state.
- The Docs7 agents run on their schedules, which `docs7_update_site` sets. This server reads their runs and does not start them.

| Group     | Tools                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| account   | `list_teamspaces`, `open_console`, `get_teamspace`, `manage_members`                                                                                                                                                                                                                                                                                                                                               |
| libraries | `list_libraries`, `get_library`, `add_library`, `refresh_library`, `update_library_config`, `manage_library_versions`, `claim_library`, `remove_library`, `get_library_analytics`, `get_library_suggestions`, `get_library_benchmarks`, `manage_owned_library`                                                                                                                                                     |
| rules     | `manage_rules`, `get_library_policies`, `update_library_policies`, `manage_library_requests`                                                                                                                                                                                                                                                                                                                       |
| usage     | `get_teamspace_usage`, `set_spending_limit`                                                                                                                                                                                                                                                                                                                                                                        |
| docs7     | `docs7_list_sites`, `docs7_get_site`, `docs7_create_site`, `docs7_update_site`, `docs7_check_domain`, `docs7_list_deployments`, `docs7_get_deployment`, `docs7_deploy`, `docs7_remove_preview`, `docs7_get_agent_runs`, `docs7_list_pull_requests`, `docs7_connect_repository`, `docs7_manage_example_check`, `docs7_manage_feature_requests`, `docs7_get_analytics`, `docs7_query_logs`, `docs7_get_conversation` |
| ask       | `ask_list_sites`, `ask_get_site`, `ask_create_site`, `ask_verify_site`, `ask_get_analytics`, `ask_list_questions`                                                                                                                                                                                                                                                                                                  |

- Remove and delete actions (`remove_library`, `manage_members` `remove`, `manage_library_versions` `remove`, `manage_rules` `delete`, `manage_owned_library` `block` and `transfer`, `docs7_manage_feature_requests` `delete`, `docs7_remove_preview`) are marked destructive. Clients ask you before they run them unless they are set to approve tools automatically, so check your client's permission settings: that approval is the guard. They also take `confirm`, which makes the agent state the exact target (library id, email, version, rule id, request id or branch); it stops a model that skips asking, not one that is told to repeat the value.
- Deleting a whole Docs7 site or Ask site cannot be undone, so it is not in this server. Do it in [the dashboard](https://context7.com/dashboard).
- Results that hold third-party text (questions, searches, feedback, build logs, agent runs) are fenced in `<untrusted-data-…>` tags.
- Results above about 20,000 tokens are cut, with a note on how to narrow the request.

## Console

In clients that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude, ChatGPT, VS Code, Cursor), `open_console` shows a summary card in the chat (usage and spend, libraries and benchmark scores, Docs7 site traffic and searches, or Ask questions and gaps) with "Open console", which expands it to the full console. In ChatGPT the console also opens from the app sidebar and beside a chat. Ask something like "open my Context7 console" or "show my Docs7 analytics in the console". Other clients get the teamspace list as text.

The page follows the Claude and OpenAI app design guidelines: inline it fits its content (no inner scroll, no menus, two actions at most), charts and navigation are in fullscreen, and colors, fonts and borders come from the host's theme. Requests that need the model ("Fix the lowest", "Find doc gaps") go to the chat as your next message.

The page holds no credential: it reads through this server's read tools, which the client calls for it with your sign-in. Write tools are hidden from it (`_meta.ui.visibility: ["model"]`). The host enforces that, not this server: a page's `tools/call` reaches the server like the model's, so a host that ignores visibility could let a page call write tools with your sign-in. Its buttons only put a prompt in the chat, and prompts and model context name teamspaces and sites by id, never by a display name someone else chose.

Billing, plans, API keys, SSO and teamspace create or delete are not in this server. Use [the dashboard](https://context7.com/dashboard).

## Deploy

The server runs on Vercel as Web-standard functions (`api/`, routes in `vercel.json`): it keeps no session, so every request stands alone. Create a Vercel project with Root Directory `packages/admin-mcp` and the domain `admin.mcp.context7.com`. Vercel compiles `api/` and `src/` itself (`vercel.json` sets an empty build command) and serves only `public/` as static files: the landing page at `/`.

## Development

```bash
pnpm --filter @upstash/context7-admin-mcp build
pnpm --filter @upstash/context7-admin-mcp test
cd packages/admin-mcp && CONTEXT7_API_URL=http://localhost:3000/api pnpm dev   # http://localhost:3100/mcp; without CONTEXT7_API_URL it calls the production API
```

`pnpm dev` serves the `vercel.json` routes from `api/`, and its OAuth metadata names `http://localhost:3100/mcp`. An OAuth token for it works only against a management API that accepts that audience (a local context7app with `ADMIN_OAUTH_ALLOWED_AUDIENCES`, reached through `CONTEXT7_API_URL`); otherwise send `Authorization: Bearer ctx7sk-…` with a key (with Write access for changes).

The console page is a React app in `ui/` (Vite, Tailwind), built into one HTML file: `pnpm build:ui` writes `src/ui/console-html.ts`, which is committed because Vercel runs no UI build. Run it after any change under `ui/`. `pnpm demo:ui` serves the page at http://localhost:4174 inside a demo host (ext-apps' `AppBridge` and a fake backend) with theme, display mode (inline, fullscreen, or a host without fullscreen), width, Claude's theme tokens and "opened on" switches, and a log of the page's tool calls and messages.

Environment: `CONTEXT7_API_URL` (default `https://context7.com/api`), `RESOURCE_URL` (origin of the public URL, default `https://admin.mcp.context7.com`), `OAUTH_AUTH_SERVER_URL` (default `https://clerk.context7.com`).
