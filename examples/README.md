# Context7 Agent Examples

These examples show how to expose the Context7 SDK as native tools in popular TypeScript agent frameworks.

- [Vercel AI SDK](./ai-sdk): a standalone `ToolLoopAgent` with a deployable Next.js app
- [LangChain](./langchain): a LangChain agent with Context7 tools

## Run an example

Install dependencies from the repository root:

```bash
pnpm install
```

Copy the environment file for the example you want to run and add your keys:

```bash
cp examples/ai-sdk/.env.example examples/ai-sdk/.env.local
cp examples/langchain/.env.example examples/langchain/.env
```

Then run the standalone Vercel AI SDK agent, its Next.js app, or the LangChain agent:

```bash
pnpm --dir examples/ai-sdk agent
pnpm --dir examples/ai-sdk dev
pnpm --dir examples/langchain start
```
