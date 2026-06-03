---
"@upstash/context7-mcp": minor
---

Replace the in-result sign-in nudge with an MCP form elicitation. When the backend signals (via `X-Context7-Auth-Prompt: 1`) that an anonymous client has crossed the per-IP threshold, the MCP server now fires an `elicitation/create` request instead of appending instructions into the tool result.

- Surfaces the `npx ctx7 setup --<client> --mcp[ --stdio] -y` command in a client-rendered dialog rather than as model-visible text. The previous text-injection approach was treated as untrusted instruction content by some agents; elicitations are delivered out-of-band to the user so they bypass that path entirely.
- Gated on the client advertising the `elicitation` capability — clients without it see no nudge, which is a safe no-op.
- Includes a "Don't show this again" checkbox; opting out suppresses further nudges for the lifetime of the MCP process (per session id / client IP).
- Fire-and-forget: the elicitation does not block or alter the surrounding tool response.
