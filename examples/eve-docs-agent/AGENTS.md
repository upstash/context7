# Context7 Docs Agent

This project uses the eve framework. Before writing code, read the relevant guide in
`node_modules/eve/docs/`.

- The agent answers library questions with the `search_docs` tool (`agent/tools/search_docs.ts`).
- `agent/lib/context7.ts` creates the `@upstash/context7-sdk` client. With `CONTEXT7_STORE_ID`
  (the Vercel Marketplace resource), Vercel mints a short-lived token from the deployment's OIDC
  token. `CONTEXT7_API_KEY`, a key from the Context7 dashboard, takes precedence. Never commit a key.
- `agent/channels/eve.ts` is the chat channel. Replace `placeholderAuth()` with real auth before
  you expose the agent to users outside your Vercel team.
