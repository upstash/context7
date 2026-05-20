# Context7 - Live Library Documentation

This document provides guidelines for using Context7 with Claude to get up-to-date, version-specific documentation for popular libraries.

## Quick Setup

```bash
# One-time setup for Claude Code
npx ctx7 setup --claude
```

This command:
1. Authenticates via OAuth
2. Generates an API key
3. Installs the Context7 skill for Claude

## Usage Examples

Add `use context7` to your prompts to fetch live documentation:

```
How do I set up a NestJS application with TypeORM? use context7
```

```
Show me the latest Prisma schema syntax for PostgreSQL. use context7
```

```
What's the proper way to handle server-side rendering in SvelteKit? use context7
```

```
How do I create a KafkaJS producer with SASL authentication? use context7
```

## Auto-Trigger Rules

When working with the following libraries, Context7 should automatically provide live documentation:

- **NestJS** - Backend framework for building efficient, scalable Node.js applications
- **Prisma** - Next-generation ORM for Node.js and TypeScript
- **SvelteKit** - Web development framework for building fast, modern apps
- **KafkaJS** - Modern Apache Kafka client for Node.js
- **BullMA** - Premium Node.js queue system based on Redis
- **ioredis** - Robust, performance-focused Redis client for Node.js
- **@solana/web3.js** - Solana JavaScript SDK for blockchain interactions

## Best Practices

### Specify Library ID

For faster and more accurate results, include the library ID:

```
How do I configure Prisma relations? use library /prisma/docs for API and docs.
```

### Pin to a Version

Get documentation for a specific version:

```
Show me NestJS 10.x middleware patterns. use context7
```

### When to Use Context7

Always use Context7 when:
- ✅ Writing code that uses external libraries/APIs
- ✅ Looking for up-to-date code examples
- ✅ Setting up or configuring packages
- ✅ Debugging library-specific issues
- ✅ Learning new framework features

No need to specify when:
- ❌ General programming questions
- ❌ Algorithm or data structure discussions
- ❌ Pure logic without external dependencies

## Available MCP Tools

When Context7 is set up, the following tools are available:

- `resolve-library-id`: Find the correct library ID for a package
- `query-docs`: Retrieve specific documentation for a library

## Learn More

- [Context7 Documentation](https://context7.com/docs)
- [Adding Libraries](https://context7.com/docs/adding-libraries)
- [Troubleshooting](https://context7.com/docs/resources/troubleshooting)
