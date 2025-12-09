# Upstash Context7 SDK

> ⚠️ **Work in Progress**: This SDK is currently under active development. The API is subject to change and may introduce breaking changes in future releases.

`@upstash/context7-sdk` is an HTTP/REST based client for TypeScript, built on top of the [Context7 API](https://context7.com).

## Why Context7?

LLMs rely on outdated or generic training data about the libraries you use. This leads to:

- Code examples based on year-old training data
- Hallucinated APIs that don't exist
- Generic answers for old package versions

Context7 solves this by providing up-to-date, version-specific documentation and code examples directly from the source. Use this SDK to:

- Build AI agents with accurate, current documentation context
- Create RAG pipelines with reliable library documentation
- Power code generation tools with real API references

## Quick Start

### Install

```bash
npm install @upstash/context7-sdk
```

### Get API Key

Get your API key from [Context7](https://context7.com)

## Basic Usage

```ts
import { Context7 } from "@upstash/context7-sdk";

const client = new Context7({
  apiKey: "<CONTEXT7_API_KEY>",
});

// Search for libraries in the Context7 database
const libraries = await client.searchLibrary("react");
console.log(libraries.results);

// Query the documentation with specific topics
const filteredDocs = await client.getDocs("/facebook/react", {
  topic: "hooks",
  limit: 10,
  page: 1,
});

// Get documentation as JSON by default
const docs = await client.getDocs("/vercel/next.js");
console.log(docs.snippets);

// Get documentation as TXT
const codeDocs = await client.getDocs("/mongodb/docs", {
  format: "txt",
  mode: "code",
});
console.log(codeDocs.content);
```

## Configuration

### Environment Variables

You can set your API key via environment variable:

```sh
CONTEXT7_API_KEY=ctx7sk-...
```

Then initialize without options:

```ts
const client = new Context7();
```

## Docs

See the [documentation](https://context7.com/docs/sdks/ts/getting-started) for details.

## Contributing

### Running tests

```sh
pnpm test
```

### Building

```sh
pnpm build
```
