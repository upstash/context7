# Context7 with Vercel AI SDK

This example wraps the Context7 SDK in two Vercel AI SDK tools:

1. `resolveLibrary` finds the Context7 ID for a library.
2. `queryDocs` retrieves documentation ranked for the user's question.

The `ToolLoopAgent` decides when to call each tool and uses the returned documentation to answer the prompt.

From the repository root:

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --dir examples ai-sdk
```

See [`index.ts`](./index.ts) for the complete example.
