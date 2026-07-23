---
description: Fetch Context7 documentation for a library
argument-hint: <library> <question>
---

Look up documentation for `$1` using Context7.

1. Derive a focused documentation question from `${@:2}`. Keep details that improve retrieval, omit unrelated details, and separate distinct documentation needs.
2. Call the `resolve-library-id` tool with `libraryName="$1"` and the focused question as `query` to find the best matching library.
3. Call the `query-docs` tool with the selected library ID and the focused question as `query`.
4. Summarize the answer for the user with code examples from the returned snippets. Cite the Context7 library ID you used.

If `$1` is already in `/org/project` or `/org/project/version` format, skip library resolution and call `query-docs` with the focused question.
