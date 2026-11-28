---
"@upstash/context7-mcp": patch
---

The server instructions now tell the agent to call Context7 before it writes any answer with code, configuration, commands, or API details from a library, runtime, tool, or service. They list the cases that agents often answer from memory and name no specific libraries. They also say when not to call (routine commands and edits, docs already fetched), what to do when Context7 has no match or returns an error, and that user and project instructions come first. `resolve-library-id` and `query-docs` now set `_meta["anthropic/alwaysLoad"]`, so Claude Code loads them up front instead of deferring them behind tool search.
