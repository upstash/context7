# @upstash/context7-pi

Official [Context7](https://context7.com) extension for the [pi coding agent](https://pi.dev).

Adds up-to-date library documentation to pi via two LLM-callable tools — `resolve-library-id` and `query-docs` — plus a skill that teaches the agent when to use them and a `/c7-docs` slash command for manual lookups.

## Install

```bash
pi install npm:@upstash/context7-pi
```

## Authenticate

The extension works without any setup at IP-based rate limits — useful for trying it out. For higher quotas, generate a free key at [context7.com/dashboard](https://context7.com/dashboard) and export it:

```bash
export CONTEXT7_API_KEY=ctx7sk_...
```

Set it in your shell profile so pi picks it up on launch.

## What it adds

- **`resolve-library-id`** — converts a package or product name to a Context7 library ID (e.g. `Next.js` → `/vercel/next.js`). The agent should call this first.
- **`query-docs`** — fetches documentation and code examples for a resolved library ID.
- **`context7-docs` skill** — instructs the agent to reach for these tools whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service.
- **`/c7-docs <library> <question>`** — slash command that runs the resolve + query flow in one shot.

## Usage

Once installed, just ask the agent a docs question and the tools are invoked automatically:

```
how do I configure caching in Next.js 16?
```

For a manual lookup:

```
/c7-docs next.js Cache Components
```

## License

MIT
