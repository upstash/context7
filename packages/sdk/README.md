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

// Search for libraries
const libraries = await client.searchLibrary("I need to build a UI with components", "react");
console.log(libraries[0].id); // "/facebook/react"

// Get documentation as JSON array (default)
const docs = await client.getContext("How do I use hooks?", "/facebook/react");
console.log(docs[0].title, docs[0].content);

// Get documentation context as plain text
const context = await client.getContext("How do I use hooks?", "/facebook/react", { type: "txt" });
console.log(context);
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

### Production HTTP options

Requests time out after 30 seconds and retry transient network errors, `408`, `425`, `429`,
and `5xx` responses by default. You can configure those defaults for the client and override
timeout, cancellation, and native fetch caching per request:

```ts
import { Context7, Context7Error } from "@upstash/context7-sdk";

const client = new Context7({
  apiKey: process.env.CONTEXT7_API_KEY,
  timeout: 10_000,
  retry: {
    retries: 3,
    backoff: (attempt) => 100 * 2 ** attempt,
  },
  onResponse: ({ status, requestId, rateLimit, attempt }) => {
    console.log({ status, requestId, rateLimit, attempt });
  },
});

const controller = new AbortController();

try {
  const docs = await client.getContext("How do I use hooks?", "/facebook/react", {
    signal: controller.signal,
    timeout: 5_000,
    cache: "no-store",
  });
  console.log(docs);
} catch (error) {
  if (error instanceof Context7Error) {
    console.error(error.code, error.status, error.requestId, error.rateLimit);
  }
}
```

The client also accepts `baseUrl`, `headers`, and a custom `fetch` implementation for proxies,
instrumentation, tests, and runtimes that do not expose a global `fetch`. The configured API key
always controls the `Authorization` header.

Set `retry: false` to make exactly one request, `timeout: false` to disable the request timeout,
or `cache: false` to omit the native fetch cache option.

Only `GET` requests are retried by default. Future mutating operations remain single-attempt unless
you explicitly include `"POST"` in `retry.methods`.

## Docs

See the [documentation](https://context7.com/docs/sdks/ts/getting-started) for details.

## Contributing

### Running tests

```sh
pnpm test
```

Run the live API integration tests separately with a configured API key:

```sh
pnpm test:integration
```

### Building

```sh
pnpm build
```
