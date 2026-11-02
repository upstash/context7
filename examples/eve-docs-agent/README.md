# Context7 Docs Agent

An [eve](https://eve.dev) agent that answers questions about libraries, frameworks, and APIs from
their current, official documentation. It searches with [Context7 Search](https://context7.com)
through [`@upstash/context7-sdk`](https://www.npmjs.com/package/@upstash/context7-sdk) and cites
the sources it used.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fcontext7%2Ftree%2Fmaster%2Fexamples%2Feve-docs-agent&project-name=context7-docs-agent&repository-name=context7-docs-agent&env=CONTEXT7_API_KEY&envDescription=Your%20Context7%20API%20key&envLink=https%3A%2F%2Fcontext7.com%2Fdashboard&demo-title=Context7%20Docs%20Agent&demo-description=An%20eve%20agent%20that%20answers%20library%20questions%20from%20up-to-date%20documentation%20with%20Context7%20Search.)

## Features

- Searches up-to-date documentation for thousands of libraries before it answers.
- Accepts an optional library and version, for example `/vercel/next.js` at `15.4.0`.
- Cites the source URL of each snippet it uses.
- Runs on eve's built-in chat channel, so you can talk to it from the terminal right away.

## Deploy

1. Create an API key in the [Context7 dashboard](https://context7.com/dashboard).
2. Select **Deploy** and paste the key when Vercel asks for `CONTEXT7_API_KEY`.
3. Clone the new repository and link it: `vercel link`.
4. Chat with the deployment from your terminal:

   ```bash
   npx eve remote connect --url https://<your-deployment>.vercel.app
   ```

   Ask, for example: "How do I stream a response from a Next.js route handler?"

The chat channel accepts your team's Vercel OIDC token in production. To expose the agent to other
users, replace `placeholderAuth()` in `agent/channels/eve.ts` with your own auth, or add another
channel such as Slack.

## How it works

- `agent/tools/search_docs.ts` is the only tool. The model calls it before it answers a library
  question, and it calls `search`, which returns ranked documentation snippets with their source
  URLs.
- `agent/lib/context7.ts` creates the SDK client, which reads `CONTEXT7_API_KEY`.
- `agent/instructions.md` tells the agent to search first, prefer the documented code, and cite
  its sources.

Each search is one Context7 request and counts against your Context7 plan.

## Project structure

```
agent/
  agent.ts            Model and agent definition
  instructions.md     System instructions
  channels/eve.ts     Chat channel and its auth
  lib/context7.ts     Context7 SDK client
  tools/search_docs.ts
```

## Develop locally

Requires Node.js 24.

```bash
pnpm install
vercel link
vercel env pull
pnpm dev
```

`vercel env pull` writes `CONTEXT7_API_KEY` and the AI Gateway credentials to `.env.local`. To run
without Vercel, copy `.env.example` to `.env.local` and fill in your Context7 API key and an AI
Gateway API key.

Edit `agent/instructions.md` to change how the agent answers, and add tools under
`agent/tools/`. eve's guides are in `node_modules/eve/docs/` after install.

## Learn more

- [Context7 Search API](https://context7.com/docs/api-guide)
- [eve documentation](https://eve.dev/docs)

## License

MIT. Based on the templates in [vercel/eve](https://github.com/vercel/eve) (Apache-2.0).
