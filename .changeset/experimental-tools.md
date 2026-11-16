---
"@upstash/context7-mcp": minor
---

The research preview is now called experimental tools, and each one can be turned on alone. A signed-in client (OAuth or an API key) lists the experimental tools its user turned on at the MCP Tools card of context7.com/dashboard?tab=settings, where "All experimental tools" also turns on the ones added later; the hosted server shows a change within a few minutes, and the stdio server reads it when it starts. `--experimental`, `CONTEXT7_EXPERIMENTAL=1` and `?experimental=1` still turn on every experimental tool, and the old names (`--research-preview`, `CONTEXT7_RESEARCH_PREVIEW=1`, `?research_preview=1`) still work. A signed-in client's `tools/list` is now private and kept 5 minutes. API calls with an experimental tool on send `X-Context7-Experimental: 1` in place of `X-Context7-Research-Preview: 1`.
