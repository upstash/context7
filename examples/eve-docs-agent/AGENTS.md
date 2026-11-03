# Context7 Docs Agent

This project uses the eve framework. Before writing code, read the relevant guide in
`node_modules/eve/docs/`.

- The agent answers library questions with the `search_docs` tool (`agent/tools/search_docs.ts`).
- `agent/lib/context7.ts` creates the `@upstash/context7-sdk` client. It uses `CONTEXT7_API_KEY`, a
  key from the Context7 dashboard, when it is set; otherwise `getIntegrationToken("context7")` from
  `@vercel/integrations` mints a short-lived token for the project's Context7 Marketplace resource.
  Never commit a key.
- `agent/channels/eve.ts` is the chat channel. Replace `placeholderAuth()` with real auth before
  you expose the agent to users outside your Vercel team.
