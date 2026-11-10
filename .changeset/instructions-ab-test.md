---
"@upstash/context7-mcp": patch
---

The hosted server can run an A/B test of the server instructions. Set `CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT` (0-100) to send that share of callers the previous instructions without `alwaysLoad`; the rest get the current ones. A salted hash of a stable caller identity (API key hash, JWT subject, token hash, or client IP) keeps each caller in one arm, and `CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT` changes the split. While the test runs, `tools/list` and `server/discover` are not shared across callers; API calls send `X-Context7-Instructions-Variant`, `X-Context7-Instructions-Unit` (salted caller hash), and `X-Context7-Instructions-Control-Percent`; instruction requests are counted per arm and client, and tool calls carry the arm on the MCP operation metric. The default of 0 leaves the test off, and stdio installs are not part of it.
