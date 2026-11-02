---
"@upstash/context7-mcp": minor
---

Research preview: a `submit-docs-feedback` tool sends feedback on the documentation that `query-docs` returned: a score from 0 to 5, what was wrong, and a short comment. It is listed only with research preview on: `--research-preview` or `CONTEXT7_RESEARCH_PREVIEW=1` for stdio, and `?research_preview=1` on the MCP URL for the hosted server. With research preview on, the server instructions also ask the agent to send this feedback after it answers. API calls carry `X-Context7-Research-Preview: 1`, so Context7 can count how many people use the research preview.
