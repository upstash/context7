# Context7 Admin plugin for Codex

Manage Context7 from Codex and ChatGPT: teamspace usage and spend, libraries and their benchmark scores, Docs7 sites and their builds, and Ask sites. The plugin connects the hosted [Context7 Admin MCP server](https://admin.mcp.context7.com) and adds three skills:

| Skill             | Use it to                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `setup`           | Sign in, pick a teamspace and see what is there. It is the plugin's onboarding skill.                                        |
| `improve-docs`    | Find the questions the docs answer badly (benchmarks, suggestions, Docs7 searches, Ask gaps) and fix them in the repository. |
| `fix-docs7-build` | Read a failed Docs7 build's health issues and logs, fix the docs, and deploy a preview.                                      |

In clients that show MCP Apps (ChatGPT, and Codex in the ChatGPT desktop app where apps render), "Open my Context7 console" shows a summary card that expands to the full console. The Codex CLI shows the same data as text.

## Install

```bash
codex plugin marketplace add upstash/context7
codex plugin add context7-admin@context7-marketplace
```

Sign in with your Context7 account when the browser opens. Start a new thread so Codex loads the skills and tools.

## Test a local checkout

1. Point the marketplace at the checkout (this replaces any `context7-marketplace` you added before):

   ```bash
   codex plugin marketplace remove context7-marketplace
   codex plugin marketplace add /path/to/context7
   codex plugin add context7-admin@context7-marketplace
   ```

   In the ChatGPT desktop app, open the checkout as a project: the repository marketplace (`.agents/plugins/marketplace.json`) shows as a source in the Plugins Directory. Restart the app after a change.

2. The plugin's server is production. To test server changes, run the server locally (`pnpm --filter @upstash/context7-admin-mcp dev`, port 3100) and add it beside the plugin in `~/.codex/config.toml`:

   ```toml
   [mcp_servers.context7-admin-local]
   url = "http://localhost:3100/mcp"
   ```

   Then run `codex mcp login context7-admin-local`. The token is issued for `http://localhost:3100/mcp`, so the management API must accept that audience: point the server at a local Context7 app (`CONTEXT7_API_URL`) that lists it in `ADMIN_OAUTH_ALLOWED_AUDIENCES`, or send a `ctx7sk-` key with Management access instead (`bearer_token_env_var`).

3. Check that the skills load: type `$` in Codex and look for `context7-admin:setup`, `context7-admin:improve-docs` and `context7-admin:fix-docs7-build`.
