# Context7 with Vercel AI SDK

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fupstash%2Fcontext7%2Ftree%2Fmaster%2Fexamples%2Fai-sdk&env=CONTEXT7_API_KEY%2COPENAI_API_KEY&envDescription=API%20keys%20for%20Context7%20and%20OpenAI.&project-name=context7-agent&repository-name=context7-agent)

This example wraps the Context7 SDK in two Vercel AI SDK tools:

1. `resolveLibrary` finds the Context7 ID for a library.
2. `queryDocs` retrieves documentation ranked for the user's question.

The `ToolLoopAgent` decides when to call each tool and uses the returned documentation to answer the question. You can run the agent directly or through the included Next.js app.

## Run the agent

From the repository root:

```bash
cp examples/ai-sdk/.env.example examples/ai-sdk/.env.local
pnpm install
pnpm --dir examples/ai-sdk agent
```

Pass a custom prompt after `--`:

```bash
pnpm --dir examples/ai-sdk agent -- "How do I revalidate a Next.js page on demand?"
```

## Run the Next.js app

```bash
pnpm --dir examples/ai-sdk dev
```

Open [http://localhost:3000](http://localhost:3000).
