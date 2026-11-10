---
"@upstash/context7-mcp": patch
---

The hosted server can run an A/B test of the server instructions. Set `CONTEXT7_INSTRUCTIONS_CONTROL_PERCENT` (0-100) to send that share of callers the previous instructions without `alwaysLoad`; the rest get the current ones. A salted hash of the API key, or of the client IP, keeps each caller in one arm, and `CONTEXT7_INSTRUCTIONS_EXPERIMENT_SALT` changes the split. While the test runs, `tools/list` is not shared across callers, API calls send `X-Context7-Instructions-Variant`, and two counters record instruction requests and tool calls per arm and client. The default of 0 leaves the test off, and stdio installs are not part of it.
