# Context7 Serverless MCP (Next.js)

A minimal serverless HTTP MCP server for Context7, built with Next.js. It exposes an MCP endpoint your editor (Cursor, Claude Code, VS Code, etc.) can call to fetch up-to-date, version-specific docs and code examples from Context7.

## Quick Start

Run locally:

```bash
npm run dev
```

Test the MCP endpoint with MCP Inspector:

```bash
npx -y @modelcontextprotocol/inspector http://localhost:3000/mcp
```

## Endpoint

- MCP endpoint: `/mcp`
- Uses Node runtime since this project relies on Node APIs.

## Auth & Headers

Provide your Context7 API key via one of the following request headers:

- `Authorization: Bearer <YOUR_API_KEY>`
- `Context7-API-Key: <YOUR_API_KEY>`

The server forwards an encrypted client IP to Context7 when available.

## Deploy

Deploy to Vercel as a standard Next.js app.

```bash
vercel
```

## Notes

- This endpoint uses the HTTP MCP transport (SSE is not supported for serverless).
- Large responses stream back to clients; verify function timeouts in your deployment target.
