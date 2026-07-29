// Drives the lazy-auth gate end-to-end over raw HTTP and prints what each
// client family actually sees. Raw fetch rather than the MCP SDK client on
// purpose: the status code, the WWW-Authenticate header and the `_meta`
// challenge are the whole contract, and an SDK client hides all three.
//
//   # terminal 1 — small allowance so the challenge fires quickly
//   CONTEXT7_ANON_FREE_CALLS=3 node dist/index.js --transport http --port 3000
//
//   # terminal 2
//   node scripts/lazy-auth-probe.mjs
//
// Env: MCP_URL (default http://localhost:3000/mcp), MAX_CALLS (default 8).
const url = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 8);

// User-Agents that select each challenge shape. See challengeTransportFor().
const CLIENTS = [
  { label: "spec client (Claude, VS Code, Cursor, …)", ua: "claude-code/2.1.0" },
  { label: "OpenAI client (ChatGPT, Codex)", ua: "codex_cli_rs/0.104.0" },
];

async function rpc(method, params, { ua, sessionId }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": ua,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const raw = await res.text();
  // Tool calls come back as SSE so headers flush before the tool finishes.
  const payload = raw.startsWith("event:") || raw.startsWith("data:") ? sseData(raw) : raw;
  let body;
  try {
    body = JSON.parse(payload);
  } catch {
    body = payload;
  }
  return {
    status: res.status,
    wwwAuthenticate: res.headers.get("www-authenticate"),
    sessionId: res.headers.get("mcp-session-id"),
    body,
  };
}

function sseData(raw) {
  return raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
}

function challengeOf(res) {
  if (res.status === 401 || res.status === 403) {
    return { shape: `HTTP ${res.status}`, header: res.wwwAuthenticate };
  }
  const meta = res.body?.result?._meta?.["mcp/www_authenticate"];
  if (Array.isArray(meta) && meta.length > 0) {
    return { shape: "200 + _meta[mcp/www_authenticate]", header: meta[0] };
  }
  return null;
}

async function probe({ label, ua }) {
  console.log(`\n=== ${label}`);
  console.log(`    User-Agent: ${ua}`);

  const init = await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "lazy-auth-probe", version: "0.0.0" },
    },
    { ua }
  );
  if (init.status !== 200) {
    console.log(`    initialize FAILED with ${init.status} — lazy auth must let this through`);
    return false;
  }
  const sessionId = init.sessionId;
  console.log(`    initialize: 200 anonymously (session ${sessionId ?? "none"})`);

  const list = await rpc("tools/list", {}, { ua, sessionId });
  const tools = list.body?.result?.tools ?? [];
  console.log(`    tools/list: 200 anonymously, ${tools.length} tool(s)`);
  for (const tool of tools) {
    const schemes = (tool.securitySchemes ?? [])
      .map((s) => (s.type === "oauth2" ? `oauth2(${s.scopes?.join(" ")})` : s.type))
      .join(" + ");
    console.log(`      - ${tool.name}: ${schemes || "no securitySchemes advertised!"}`);
  }

  for (let i = 1; i <= MAX_CALLS; i++) {
    const res = await rpc(
      "tools/call",
      { name: "resolve-library-id", arguments: { query: "routing", libraryName: "react" } },
      { ua, sessionId }
    );
    const challenge = challengeOf(res);
    if (!challenge) {
      console.log(`    call ${i}: allowed`);
      continue;
    }
    console.log(`    call ${i}: CHALLENGED as ${challenge.shape}`);
    console.log(`      ${challenge.header}`);
    console.log("      A real client now runs OAuth and retries this same call.");
    return true;
  }

  console.log(`    no challenge in ${MAX_CALLS} calls — is CONTEXT7_ANON_FREE_CALLS low enough?`);
  return false;
}

async function checkDiscovery() {
  const origin = new URL(url).origin;
  const paths = [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ];
  console.log("\n=== OAuth discovery documents");
  for (const path of paths) {
    const res = await fetch(origin + path);
    const doc = res.ok ? await res.json() : null;
    const servers = doc
      ? ` -> authorization_servers=${JSON.stringify(doc.authorization_servers)}`
      : "";
    console.log(`    ${path}: ${res.status}${servers}`);
  }
}

let ok = true;
for (const client of CLIENTS) {
  ok = (await probe(client)) && ok;
}
await checkDiscovery();

console.log(
  ok
    ? "\nBoth client families were challenged in the shape they understand."
    : "\nAt least one probe did not reach a challenge — see above."
);
process.exit(ok ? 0 : 1);
