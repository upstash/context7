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

## Teamspaces and sites

One OAuth connection reaches every teamspace you are a member of, with your role in each.

- Each tool takes `teamspace`: an id or a name. Leave it out when you have one teamspace. With several, the agent can work on many in one session by passing a different `teamspace` on each call.
- Docs7 and Ask sites belong to a teamspace. `docs7_list_sites` and `ask_list_sites` give their ids; every site tool takes `site_id` (Docs7) or `site_key` (Ask).
- To keep a connection on one teamspace, add `?teamspace=<id>` to the URL. You can add the server more than once, one entry per teamspace.
- An API key belongs to one teamspace. Use one key (and one server entry) per teamspace.

## Query parameters

| Parameter        | Effect                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `teamspace=<id>` | Pins the server to one teamspace. Tools do not take a `teamspace` argument, and `list_teamspaces` is hidden.                |
| `read_only=true` | Hides every tool and `action` that changes data.                                                                            |
| `features=a,b`   | Turns on only these groups: `account`, `libraries`, `rules`, `usage`, `docs7`, `ask`. Default: all. `account` is always on. |

## Tools

- `teamspace` takes an id or a name. Leave it out when you have one teamspace; with several, the error lists them.
- Library ids take `/owner/repo`, `owner/repo` or a context7.com library URL.
- Long jobs (library parse, Docs7 build, Ask crawl): call `get_library`, `docs7_get_deployment` or `ask_get_site` with `wait: true`. The server waits up to about 25 seconds for a final state.
- The Docs7 agents run on their schedules, which `docs7_update_site` sets. This server reads their runs and does not start them.

| Group     | Tools                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| account   | `list_teamspaces`, `get_teamspace`, `manage_members`                                                                                                                                                                                                                                                                         |
| libraries | `list_libraries`, `get_library`, `add_library`, `refresh_library`, `update_library_config`, `manage_library_versions`, `claim_library`, `remove_library`, `get_library_analytics`, `get_library_suggestions`                                                                                                                 |
| rules     | `manage_rules`, `get_library_policies`, `update_library_policies`, `manage_library_requests`                                                                                                                                                                                                                                 |
| usage     | `get_teamspace_usage`, `set_spending_limit`                                                                                                                                                                                                                                                                                  |
| docs7     | `docs7_list_sites`, `docs7_get_site`, `docs7_create_site`, `docs7_update_site`, `docs7_check_domain`, `docs7_list_deployments`, `docs7_get_deployment`, `docs7_deploy`, `docs7_remove_preview`, `docs7_get_agent_runs`, `docs7_manage_feature_requests`, `docs7_get_analytics`, `docs7_query_logs`, `docs7_get_conversation` |
| ask       | `ask_list_sites`, `ask_get_site`, `ask_create_site`, `ask_verify_site`, `ask_get_analytics`, `ask_list_questions`                                                                                                                                                                                                            |

- Remove and delete actions (`remove_library`, `manage_members` `remove`, `manage_library_versions` `remove`, `manage_rules` `delete`, `docs7_remove_preview`) are marked destructive, so your client asks you before it runs them. That approval is the guard. They also take `confirm`, which makes the agent state the exact target (library id, email, version, rule id or branch); it stops a model that skips asking, not one that is told to repeat the value.
- Deleting a whole Docs7 site or Ask site cannot be undone, so it is not in this server. Do it in [the dashboard](https://context7.com/dashboard).
- Results that hold third-party text (questions, searches, feedback, build logs, agent runs) are fenced in `<untrusted-data-…>` tags.
- Results above about 20,000 tokens are cut, with a note on how to narrow the request.

Billing, plans, API keys, SSO and teamspace create or delete are not in this server. Use [the dashboard](https://context7.com/dashboard).

## Deploy

The server runs on Vercel as Web-standard functions (`api/`, routes in `vercel.json`): it keeps no session, so every request stands alone. Create a Vercel project with Root Directory `packages/admin-mcp` and the domain `admin.mcp.context7.com`. Vercel compiles `api/` and `src/` itself; `vercel.json` sets an empty build command, so the project serves functions only.

## Development

```bash
pnpm --filter @upstash/context7-admin-mcp build
pnpm --filter @upstash/context7-admin-mcp test
cd packages/admin-mcp && CONTEXT7_API_URL=http://localhost:3000/api npx vercel dev
```

Environment: `CONTEXT7_API_URL` (default `https://context7.com/api`), `RESOURCE_URL` (origin of the public URL, default `https://admin.mcp.context7.com`), `OAUTH_AUTH_SERVER_URL` (default `https://clerk.context7.com`).
