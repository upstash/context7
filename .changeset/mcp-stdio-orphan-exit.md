---
"@upstash/context7-mcp": patch
---

Exit the stdio MCP server when the parent process closes its stdio. Previously, if the parent (e.g. Claude Code) was force-killed shortly after a tool call, an idle undici keep-alive socket to the Context7 API would keep libuv's event loop alive past stdin EOF, leaving an orphaned `node` process that consumed memory until the kernel tore the socket down (which on Cloudflare-fronted endpoints can take hours). The server now listens for `end`/`close` on stdin and `SIGHUP` and exits cleanly. Fixes #2542.
