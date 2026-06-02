---
"ctx7": patch
---

`ctx7 setup --api-key <KEY>` (without `--cli`, `--mcp`, or `-y`) now prompts to choose between MCP server and CLI + Skills modes. Previously, passing `--api-key` short-circuited to MCP, locking users out of the CLI + Skills option even though that mode also accepts an API key. Explicit `--mcp` / `--cli` / `--stdio` / `--oauth` / `-y` still skip the prompt as before.
