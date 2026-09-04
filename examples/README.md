# Context7 Agent Examples

These examples show how to expose the Context7 SDK as native tools in popular TypeScript agent frameworks.

- [Vercel AI SDK](./ai-sdk): a `ToolLoopAgent` with Context7 tools
- [LangChain](./langchain): a LangChain agent with Context7 tools

## Run an example

Install dependencies from the repository root:

```bash
pnpm install
```

Copy the environment file and add your keys:

```bash
cp examples/.env.example examples/.env
```

Then run either example:

```bash
pnpm --dir examples ai-sdk
pnpm --dir examples langchain
```
