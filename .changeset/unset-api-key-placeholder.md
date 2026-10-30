---
"@upstash/context7-mcp": patch
---

In stdio mode, an API key that is an unset variable placeholder (`${CONTEXT7_API_KEY}` or `$CONTEXT7_API_KEY`) now counts as no key: the server logs a warning and runs without a key. Before, it sent the placeholder as the key and every tool call failed with 401. Gemini CLI passes the placeholder through when the user skips the Context7 extension's API key prompt.
