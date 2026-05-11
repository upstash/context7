---
"@upstash/context7-mcp": patch
---

Accept hallucinated argument names on `tools/call` requests by rewriting them to the canonical names before validation. `context7CompatibleLibraryID` is mapped to `libraryId` and `userQuery` is mapped to `query` on incoming MCP messages. Some LLM clients produce these alternative names — likely echoing phrasing from each tool's description — and previously triggered `Invalid input: expected string, received undefined` errors. Tool input schemas published via `tools/list` are unchanged: canonical names remain the documented required fields, the rewrite is purely a server-side compatibility shim that runs only on `tools/call` and only when the canonical key is absent.
