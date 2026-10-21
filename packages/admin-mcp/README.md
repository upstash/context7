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

Create a Context7 API key in [the dashboard](https://context7.com/dashboard) with **Management access** turned on, and send it as a bearer. A key without management access gets 403, and a key reaches only its own teamspace.

```json
{
  "mcpServers": {
    "context7-admin": {
      "type": "http",
      "url": "https://admin.mcp.context7.com/mcp?teamspace=YOUR_TEAMSPACE_ID",
      "headers": { "Authorization": "Bearer ctx7sk-..." }
    }
  }
}
```

## Query parameters

| Parameter        | Effect                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `teamspace=<id>` | Pins the server to one teamspace. Tools do not take a `teamspace` argument, and `list_teamspaces` is hidden.                |
| `read_only=true` | Hides every tool and `action` that changes data.                                                                            |
| `features=a,b`   | Turns on only these groups: `account`, `libraries`, `rules`, `usage`, `docs7`, `ask`. Default: all. `account` is always on. |

## Tools

| Group     | Tools                                                                                                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| account   | `list_teamspaces`, `get_teamspace`, `manage_members`                                                                                                                                                                                                                   |
| libraries | `list_libraries`, `get_library`, `add_library`, `refresh_library`, `update_library_config`, `manage_library_versions`, `claim_library`, `remove_library`, `get_library_analytics`                                                                                      |
| rules     | `manage_rules`, `get_policies`, `update_policies`, `manage_library_requests`                                                                                                                                                                                           |
| usage     | `get_usage`, `set_spending_limit`                                                                                                                                                                                                                                      |
| docs7     | `list_sites`, `get_site`, `create_site`, `update_site`, `check_domain`, `list_deployments`, `get_deployment`, `deploy_site`, `remove_preview`, `run_site_agent`, `get_agent_runs`, `manage_site_findings`, `get_site_analytics`, `query_site_logs`, `get_conversation` |
| ask       | `list_ask_sites`, `get_ask_site`, `create_ask_site`, `verify_ask_site`, `get_ask_analytics`, `list_ask_questions`                                                                                                                                                      |

- `remove_library`, `manage_members` `remove`, `manage_library_versions` `remove`, `manage_rules` `delete` and `remove_preview` need `confirm` set to the library id, the member's email, the version name, the rule id or the branch name. The agent must ask you first.
- Deleting a whole Docs7 site or Ask site cannot be undone, so it is not in this server. Do it in [the dashboard](https://context7.com/dashboard).
- Results that hold third-party text (questions, searches, feedback, build logs, agent runs) are fenced in `<untrusted-data-…>` tags.
- Results above about 20,000 tokens are cut, with a note on how to narrow the request.

Billing, plans, API keys, SSO and teamspace create or delete are not in this server. Use [the dashboard](https://context7.com/dashboard).

## Deploy

The server runs on Vercel as Web-standard functions (`api/`, routes in `vercel.json`): it keeps no session, so every request stands alone. Create a Vercel project with Root Directory `packages/admin-mcp` and the domain `admin.mcp.context7.com`. `pnpm build` compiles `src/` to `dist/`, which the functions import.

## Development

```bash
pnpm --filter @upstash/context7-admin-mcp build
pnpm --filter @upstash/context7-admin-mcp test
cd packages/admin-mcp && CONTEXT7_API_URL=http://localhost:3000/api npx vercel dev
```

Environment: `CONTEXT7_API_URL` (default `https://context7.com/api`), `RESOURCE_URL` (origin of the public URL, default `https://admin.mcp.context7.com`), `OAUTH_AUTH_SERVER_URL` (default `https://clerk.context7.com`).
