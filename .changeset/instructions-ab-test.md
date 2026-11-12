---
"@upstash/context7-mcp": patch
---

The hosted server can run an A/B test of the server instructions. Set `CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT` (1-100) with `CONTEXT7_INSTRUCTIONS_EXPERIMENT_ID` and a secret `CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT` to send that share of callers the previous instructions without `alwaysLoad`; the rest get the current ones. Unset or 0 turns it off; an invalid value fails startup. A salted hash of a stable caller identity (API key hash, JWT subject, token hash, or the client IP or IPv6 /64) keeps each caller in one arm. While the test runs, `tools/list` and `server/discover` are not shared across callers, API calls carry the arm as an encrypted `X-Context7-Instructions-Assertion` (sealed with `MCP_CLIENT_IP_ASSERTION_KEY`), and each instructions request is reported to context7app as an exposure. Stdio installs are not part of it.
