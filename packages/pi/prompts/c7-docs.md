---
description: Fetch Context7 documentation for a library
argument-hint: <library> <question>
---

Look up documentation for `$1` using Context7.

1. Call the `resolve-library-id` tool with `libraryName="$1"` and `query="${@:2}"` to find the best matching library.
2. Call the `query-docs` tool with the selected library ID and `query="${@:2}"`.
3. Summarize the answer for the user with code examples from the returned snippets. Cite the Context7 library ID you used.

If `$1` is already in `/org/project` or `/org/project/version` format, skip step 1 and call `query-docs` directly.
