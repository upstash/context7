---
"@upstash/context7-mcp": patch
---

Require authentication on `/mcp` when the `client` query parameter identifies a plugin (for example `?client=claude-code-plugin`). Plugin hosts such as Claude Code only start OAuth for servers that 401 at connect time; this matches that connect-time challenge without changing anonymous access on the public `/mcp` URL.
