---
"@upstash/context7-mcp": patch
"@upstash/context7-pi": patch
"@upstash/context7-opencode": patch
"@upstash/context7-tools-ai-sdk": patch
"ctx7": patch
---

Let agents reuse a library ID they already resolved earlier in the conversation. The tool descriptions, skills, and rule templates now say to call `resolve-library-id` (or `ctx7 library`) again only for a different library or version, or when the ID returns an error.
