# Context7 Docs Agent

This project uses the eve framework. Before writing code, read the relevant guide in
`node_modules/eve/docs/`.

- The agent answers library questions with the `search_docs` tool (`agent/tools/search_docs.ts`).
- `agent/lib/context7.ts` mints a short-lived Context7 token from the deployment's Vercel OIDC
  token for the resource in `CONTEXT7_STORE_ID`. Never add a long-lived Context7 API key.
