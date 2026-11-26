# @upstash/context7-admin-mcp

## 0.1.2

### Patch Changes

- 42da8fc: Stop logging a refused `subscriptions/listen` as an error. The server allows no subscriptions, so the refusal is expected.

## 0.1.1

### Patch Changes

- 539ac8e: Number the API requests of each tool call (`X-Context7-Tool-Request`), so the admin page counts a tool call once, and log the API status and error code of a failed call. `add_library` explains `alreadyAvailable`, and the `docs7_pro_required` hint says Docs7 Pro is separate from the Context7 Pro plan.
