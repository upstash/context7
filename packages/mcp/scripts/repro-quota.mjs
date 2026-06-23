// Drives the lazy-auth quota gate end-to-end: connects anonymously, then calls
// a tool in a loop until the server returns the 401 challenge.
//
//   node dist/index.js --transport http --port 3000   # in another terminal
//   node scripts/repro-quota.mjs
//
// Run the server with a small allowance so the challenge fires quickly:
//   CONTEXT7_ANON_FREE_CALLS=3 node dist/index.js --transport http --port 3000
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://localhost:3000/mcp");
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 12);

const client = new Client({ name: "quota-repro", version: "0.0.0" }, { capabilities: {} });
// No auth provider: a 401 challenge surfaces as a thrown error instead of
// kicking off an interactive OAuth flow.
const transport = new StreamableHTTPClientTransport(url);

await client.connect(transport);
console.log(`connected anonymously to ${url.href} (initialize + tools/list cost no quota)`);

for (let i = 1; i <= MAX_CALLS; i++) {
  try {
    await client.callTool({
      name: "resolve-library-id",
      arguments: { query: "routing", libraryName: "react" },
    });
    console.log(`call ${i}: OK (under quota)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`call ${i}: CHALLENGED -> ${msg}`);
    console.log("\nLazy auth fired. A real client would now run OAuth and retry with a token.");
    process.exit(0);
  }
}

console.log(`\nNo challenge after ${MAX_CALLS} calls. Is CONTEXT7_ANON_FREE_CALLS set low enough?`);
process.exit(1);
