# Context7 with LangChain

This example wraps the Context7 SDK in two LangChain tools. The agent resolves the requested library, retrieves documentation for the question, and grounds its answer in that context.

From the repository root:

```bash
cp examples/.env.example examples/.env
pnpm install
pnpm --dir examples langchain
```

See [`index.ts`](./index.ts) for the complete example.
