---
"@upstash/context7-mcp": minor
---

Add opt-in `search-library-code` and `read-library-file` tools that search and read a library's source code at a pinned version. Enable them with `--code-search` or `CONTEXT7_CODE_SEARCH=1`. Clones run without hooks, submodules or symlinks, the cache has a size limit, and every response includes the commit, license and version match.
