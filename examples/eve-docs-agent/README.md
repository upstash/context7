# Context7 Docs Agent

A Slack agent built on [eve](https://eve.dev) that answers questions about libraries, frameworks,
and APIs from their current, official documentation. It searches with
[Context7 Search](https://context7.com) and authenticates with a short-lived Vercel OIDC token, so
there is no API key to store.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fcontext7%2Ftree%2Fmaster%2Fexamples%2Feve-docs-agent&project-name=context7-docs-agent&repository-name=context7-docs-agent&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22context7%22%2C%22productSlug%22%3A%22context7-search-api%22%7D%5D&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&demo-title=Context7%20Docs%20Agent&demo-description=A%20Slack%20agent%20on%20eve%20that%20answers%20library%20questions%20from%20up-to-date%20documentation%20with%20Context7%20Search.)

## Deploy

1. Select **Deploy**. Vercel creates the project, adds a Context7 Search resource, and connects
   Slack.
2. In the Vercel dashboard, open the Context7 resource and copy its ID. Add it to the project as
   the `CONTEXT7_STORE_ID` environment variable, then redeploy.
3. Mention the agent in Slack: "How do I stream a response from a Next.js route handler?"

## How it works

- `agent/tools/search_docs.ts` is the only tool. The model calls it before it answers a library
  question, and it calls `search` from [`@upstash/context7-sdk`](https://www.npmjs.com/package/@upstash/context7-sdk),
  which returns ranked documentation snippets with their source URLs.
- `agent/lib/context7.ts` creates the SDK client. Its `authToken` asks Vercel for a Context7 token
  (`POST https://api.vercel.com/v1/integrations/marketplace/resources/{CONTEXT7_STORE_ID}/token`,
  authorized by the deployment's own OIDC token). The token lives 300 seconds, and the client
  reuses it until shortly before it expires.
- `agent/instructions.md` tells the agent to search first, prefer the documented code, and cite
  its sources.

Each search is one Context7 request. The Free plan includes 1,000 requests a month; Pay as you go
costs $5 per 1,000 requests, billed on your Vercel invoice.

## Develop locally

Requires Node.js 24.

```bash
pnpm install
vercel link
vercel env pull
pnpm dev
```

`vercel env pull` writes the project's environment, including `CONTEXT7_STORE_ID` and a
development OIDC token. To run without Vercel, set `CONTEXT7_API_KEY` to a key from the
[Context7 dashboard](https://context7.com/dashboard) instead; the agent uses it when it is set.

Edit `agent/instructions.md` to change how the agent answers, and add tools under
`agent/tools/`. eve's guides are in `node_modules/eve/docs/` after install.

## Learn more

- [Context7 Search API](https://context7.com/docs/api-guide)
- [eve documentation](https://eve.dev/docs)
- [Vercel Connect](https://vercel.com/docs/connect) manages the Slack credentials.

Based on the `eve-slack-agent` template from [vercel/eve](https://github.com/vercel/eve) (Apache-2.0).
