# Context7 with Eve

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fcontext7%2Ftree%2Fmaster%2Fexamples%2Feve&env=CONTEXT7_API_KEY%2COPENAI_API_KEY&envDescription=API%20keys%20for%20Context7%20and%20OpenAI.&project-name=context7-eve-agent&repository-name=context7-eve-agent)

This example is a standalone [Eve](https://eve.dev) agent with two Context7 tools:

1. `resolve_library` finds the Context7 ID for a library.
2. `query_docs` retrieves documentation ranked for the user's question.

Eve discovers the agent, instructions, and tools from the files under `agent/`. The agent uses Context7 before answering questions about libraries.

## Run the agent

Eve requires Node.js 24 or newer. From the repository root:

```bash
cp examples/eve/.env.example examples/eve/.env.local
pnpm install
pnpm --dir examples/eve invoke "How do I revalidate a Next.js page on demand?"
```

Open Eve's interactive terminal UI:

```bash
pnpm --dir examples/eve dev
```

## Deploy

Use the button above or deploy with the Eve CLI:

```bash
pnpm --dir examples/eve deploy
```

The default Eve channel permits local development and authenticated Vercel requests. It rejects unauthenticated production requests until you configure an application-specific authentication policy.
