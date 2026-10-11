# Context7 docs with Parallel web search

Combine `Context7Agent`'s library documentation tools with current release announcements
and web pages using [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).
The example discovers `web_search` and `web_fetch` over HTTP and passes them through the
agent's existing `tools` option.

Parallel search uses Fast mode. Its anonymous endpoint needs no Parallel account or
API key and is rate limited for light use. This example also uses an OpenAI model
and a Context7 API key; those are separate from the free Parallel connection.

## Run

Use Node.js 22 or newer. Install the example's dependencies independently of the
monorepo, from this directory:

```sh
cd packages/tools-ai-sdk/examples/parallel-search
npm install --workspaces=false
export OPENAI_API_KEY="your-openai-key"
export CONTEXT7_API_KEY="your-context7-key"
npm start -- "Find the latest Next.js release announcement and explain its caching API using Context7 docs."
```

Set `OPENAI_MODEL` to select another OpenAI model (default: `gpt-5.2`).
Context7 tools handle library documentation; Parallel tools provide additional web
context. The agent cites source URLs and library IDs. The MCP connection closes
when generation completes or fails. Requests have a 30-second timeout, and the
whole generation has a two-minute timeout.

This is an opt-in example. The package's default agent and documentation tools
keep their existing behavior.
