# Context7 Plugin for OpenCode

Context7 solves a common problem with AI coding assistants: outdated training data and hallucinated APIs. Instead of relying on stale knowledge, Context7 fetches current documentation directly from source repositories.

## What's Included

Installing the plugin adds four things to OpenCode:

- **MCP Server** - The hosted Context7 server, with `resolve-library-id` and `query-docs`
- **Skill** - `context7-mcp` auto-triggers documentation lookups when you ask about libraries
- **Agent** - A `docs-researcher` subagent for focused lookups that keep your main context lean
- **Command** - `/context7-docs` for manual documentation queries

## Installation

```bash
opencode plugin @upstash/context7-opencode
```

The command installs the plugin and adds it to your OpenCode config. You can also add it by hand:

```json opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@upstash/context7-opencode"]
}
```

Restart OpenCode after installing. On the first documentation lookup, OpenCode opens a browser window so you can log in to Context7 via OAuth, which gives you your account's rate limits.

## API Key

OAuth is the default and needs no configuration. If you would rather use an API key, for example on a headless machine, create one in the [Context7 dashboard](https://context7.com/dashboard) and export it before launching OpenCode:

```bash
# e.g. in ~/.zshrc or ~/.bashrc
export CONTEXT7_API_KEY="your-api-key"
```

The plugin picks up `CONTEXT7_API_KEY` automatically and sends it as an `Authorization` header instead of running the OAuth flow. You can also pass the key through the plugin options:

```json opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["@upstash/context7-opencode", { "apiKey": "your-api-key" }]]
}
```

## Overriding What the Plugin Adds

Every entry the plugin adds is additive, and an entry you configure yourself always wins. If your `opencode.json` already defines an MCP server named `context7`, an agent named `docs-researcher`, or a command named `context7-docs`, the plugin leaves it untouched. To turn off the subagent, for example, define it yourself as disabled:

```json opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": { "docs-researcher": { "disable": true } }
}
```

## Usage

The skill triggers on its own when you ask about a library:

- "How do I set up authentication in Next.js 15?"
- "Show me React Server Components examples"
- "What's the Prisma syntax for relations?"

For manual lookups, use the command:

```
/context7-docs next.js app router
/context7-docs /vercel/next.js/v15.1.8 middleware
```

Or hand the lookup to the subagent when you want to keep your main context clean:

```
ask docs-researcher to look up Supabase auth methods
```

The subagent runs with `edit` denied, so it reads documentation and reports back without touching your files.

## Available Tools

### resolve-library-id

Searches for libraries and returns Context7-compatible identifiers.

```
Input: "next.js"
Output: { id: "/vercel/next.js", name: "Next.js", versions: ["v15.1.8", "v14.2.0", ...] }
```

### query-docs

Fetches documentation for a specific library, ranked by relevance to your question.

```
Input: { libraryId: "/vercel/next.js", query: "app router middleware" }
Output: Relevant documentation snippets with code examples
```

## Version Pinning

To get documentation for a specific version, include the version in the library ID:

```
/vercel/next.js/v15.1.8
/supabase/supabase/v2.45.0
```

The `resolve-library-id` tool returns available versions, so you can pick the one that matches your project.

## License

MIT
