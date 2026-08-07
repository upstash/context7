# Context7 Agent Plugin

A portable [Agent Plugin](https://agent-plugins.org) (spec 1.0.0) that gives any compatible agent
current, version-specific library documentation through the Context7 MCP server.

AI coding assistants rely on training data that goes stale and invents APIs that never existed.
Context7 fetches real documentation from source repositories at query time instead.

## What's Included

| Component  | Location               | Description                                                      |
| ---------- | ---------------------- | ---------------------------------------------------------------- |
| MCP server | `mcp.json`             | Remote Context7 server over Streamable HTTP, authorized by OAuth |
| Skill      | `skills/context7-mcp/` | Triggers documentation lookups when you ask about a library      |

## Layout

```text
context7/
├── plugin.json
├── mcp.json
├── skills/
│   └── context7-mcp/
│       └── SKILL.md
├── LICENSE
└── README.md
```

This is the entire plugin. Agent Plugins uses fixed locations, so every compatible client reads
the same two files: `plugin.json` at the root, and `mcp.json` for MCP configuration. Clients that
support skills discover them under `skills/`.

## Installation

Install the directory with your client's plugin command. The exact command differs per client,
but every conformant client accepts a plugin directory path:

```bash
<your-agent> plugin install ./plugins/agent-plugins/context7
```

You can also install straight from the repository if your client supports remote sources.

## Authentication

The plugin points at `https://mcp.context7.com/mcp/oauth`, which authorizes with OAuth 2.1.

On first connection the server answers `401` with a `WWW-Authenticate` header. Your client then
discovers the authorization server, registers itself dynamically, and opens a browser for you to
approve access. Tokens are stored by the client. You do not paste a key anywhere, and no secret
is written into this repository.

The flow supports Dynamic Client Registration and PKCE (`S256`), so no pre-registration is needed.

### Why not an API key?

Agent Plugins 1.0 deliberately has no field for credentials. Two rules in the spec make an API
key impossible to ship here:

- Clients must not expand `${VAR}` placeholders in `url` or in header names and values.
- Header values are "visible package data" and plugins must not embed secrets in them.

So the `"Authorization": "${CONTEXT7_API_KEY}"` pattern used by some client-specific plugins in
this repository is not portable. OAuth is the only way a user can authenticate their own account
in this format, which is why this plugin uses the OAuth endpoint.

### Client support

Authorization is client-managed in this spec version. A client that cannot run an OAuth flow will
fail to connect to this server. The spec treats that as a connection failure for one server, not
as a broken plugin, so the skill still loads. If your client has no OAuth support, use the
client-specific plugin for it in [`plugins/`](../../) instead.

## Available Tools

### `resolve-library-id`

Searches for libraries and returns Context7-compatible identifiers such as `/vercel/next.js`.

### `query-docs`

Fetches documentation for a resolved library ID, scoped to a single concept per call.

## Notes on Portability

- `plugin.json` uses a closed schema. Only `$schema`, `name`, `version`, `description`, `author`,
  `homepage`, `repository`, `license`, `keywords`, and `extensions` are permitted at the top level.
  Component paths cannot be declared in the manifest, unlike the Codex and Copilot manifests in
  this repository.
- No `extensions` namespace is set. Client-specific data belongs under a reverse-domain key that
  the client itself defines, so nothing is claimed here.
- Commands, agents, hooks, and rules are not portable component types in version 1.0. The
  `/context7:docs` command and the `docs-researcher` agent stay in the client-specific plugins.

## Links

- [Context7](https://context7.com) · [Dashboard](https://context7.com/dashboard)
- [Agent Plugins specification](https://agent-plugins.org/specification)
- [Agent Skills specification](https://agentskills.io/specification)
