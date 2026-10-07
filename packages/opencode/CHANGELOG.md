# @upstash/context7-opencode

## 0.2.0

### Minor Changes

- 635cfc8: Support OpenCode v2. The plugin now exports a v2 `setup` entrypoint next to the v1 `server` entrypoint, so `opencode plugin add @upstash/context7-opencode` registers the Context7 MCP server and the `context7-mcp` skill on v2 as well.

## 0.1.0

### Minor Changes

- 07580f1: Add `@upstash/context7-opencode`, the official Context7 plugin for OpenCode. Installing it registers the hosted Context7 MCP server and the `context7-mcp` skill. Authentication defaults to OAuth and falls back to `CONTEXT7_API_KEY` or an `apiKey` plugin option.
