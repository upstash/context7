# @upstash/context7-pi

## 0.1.1

### Patch Changes

- 33229cb: Clarify the `query-docs` query description so it asks for a single concept per query. When a question spans multiple distinct topics, callers are now told to make a separate query per concept instead of combining them (unless the question is about how the concepts interact), which avoids diluted, shallow results. Applied consistently across the MCP server, CLI, pi, and AI SDK tools.

## 0.1.0

### Minor Changes

- f91b40c: Initial release. Adds an official Context7 extension for the [pi coding agent](https://pi.dev) — registers `resolve-library-id` and `query-docs` tools, ships the `context7-docs` skill, and exposes a `/c7-docs` slash command. Wire format, error messages, and tool descriptions are copied verbatim from `@upstash/context7-mcp` so pi and MCP clients give the LLM identical instructions and output. Self-contained — no Context7 runtime dependencies. Works out of the box at IP-based rate limits; set `CONTEXT7_API_KEY` for the higher tier. Install with `pi install npm:@upstash/context7-pi`.
