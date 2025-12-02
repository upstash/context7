# Upstash Context7 AI SDK

`@upstash/context7-ai-sdk` provides [Vercel AI SDK](https://sdk.vercel.ai/) compatible tools and agents that give your AI applications access to up to date library documentation through Context7.

Use this package to:

- Add documentation lookup tools to your AI SDK workflows with `generateText` or `streamText`
- Create documentation aware agents using the pre-configured `context7Agent`
- Build RAG pipelines that retrieve accurate, version specific code examples

The package provides two main tools:

- `resolveLibrary` - Searches Context7's database to find the correct library ID
- `getLibraryDocs` - Fetches documentation for a specific library with optional topic filtering

## Quick Start

### Install

```bash
npm install @upstash/context7-ai-sdk
```

### Get API Key

Get your API key from [Context7](https://context7.com)

## Usage

### Using Tools with `generateText`

```typescript
import { resolveLibrary, getLibraryDocs } from "@upstash/context7-ai-sdk";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai("gpt-4o"),
  prompt: "How do I use React Server Components?",
  tools: {
    resolveLibrary: resolveLibrary(),
    getLibraryDocs: getLibraryDocs(),
  },
  maxSteps: 5,
});

console.log(text);
```

### Using the Context7 Agent

The package provides a pre-configured agent that handles the multi-step workflow automatically:

```typescript
import { context7Agent } from "@upstash/context7-ai-sdk";
import { anthropic } from "@ai-sdk/anthropic";

const agent = context7Agent({
  model: anthropic("claude-sonnet-4-20250514"),
});

const { text } = await agent.generate({
  prompt: "How do I set up routing in Next.js?",
});

console.log(text);
```

## Configuration

### Environment Variables

Set your API key via environment variable:

```sh
CONTEXT7_API_KEY=ctx7sk-...
```

Then use tools and agents without explicit configuration:

```typescript
const tool = resolveLibrary(); // Uses CONTEXT7_API_KEY automatically
```

## Docs

See the [documentation](https://context7.com/docs/sdks/ai-sdk/getting-started) for details.

## Contributing

### Running tests

```sh
pnpm test
```

### Building

```sh
pnpm build
```
