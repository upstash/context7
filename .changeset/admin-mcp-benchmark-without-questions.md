---
"@upstash/context7-admin-mcp": patch
---

The console's library benchmark shows the weakest grading criteria instead of the lowest-scoring questions, which the management API no longer returns: they are Context7 users' queries. `get_library_benchmarks` and `get_library_suggestions` describe what they now return. With `order: "newest"`, `get_library_benchmarks` now sorts the graded answers by date itself, and the server instructions and the console's prompts no longer mention failed questions.
