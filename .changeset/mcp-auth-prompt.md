---
"@upstash/context7-mcp": minor
---

Prompt anonymous users to sign in. After the backend signals (via the `X-Context7-Auth-Prompt: 1` response header on `/v2/libs/search` or `/v2/context`) that an anonymous client has crossed the per-IP threshold, the MCP server appends a one-time sign-in invitation to the tool result.

- Both **stdio** and **HTTP** transports surface the same nudge: a tool-result notice asking the assistant to run `npx ctx7 setup --<client> --mcp -y` (with `--stdio` appended when the MCP server is running on stdio) after explicit user confirmation. The CLI handles OAuth and writes credentials into the MCP client's config; the user restarts their MCP server / editor to pick up the new credentials.
- Detects the calling client from `X-Context7-Client-IDE` / User-Agent and selects the matching CLI flag (`--cursor`, `--claude`, `--codex`, `--opencode`, `--gemini`); falls back to interactive setup when unknown.
- HTTP transport remains stateless — the threshold is tracked by the backend (per-IP, 24h TTL), the MCP server only reacts to the signal.
