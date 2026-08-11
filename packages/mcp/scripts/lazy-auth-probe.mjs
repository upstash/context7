// Drives the lazy-auth gate end to end over raw HTTP and prints what each
// client family actually sees. Raw fetch rather than an MCP client on purpose:
// the status code, the WWW-Authenticate header and the `_meta` challenge are
// the whole contract, and a client library hides all three.
//
//   # terminal 1 — a backend that reports two free requests, then refuses
//   STUB_REMAINING=2 node scripts/quota-stub-backend.mjs
//
//   # terminal 2
//   CONTEXT7_API_URL=http://localhost:3099/api node dist/index.js --transport http --port 3000
//
//   # terminal 3
//   node scripts/lazy-auth-probe.mjs
//
// Env: MCP_URL (default http://localhost:3000/mcp), MAX_CALLS (default 8).
const url = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 8);

// User-Agents that select each challenge shape. See challengeTransportFor().
const CLIENTS = [
  { label: "spec client (Claude, VS Code, Cursor, Codex CLI, …)", ua: "claude-code/2.1.0" },
  { label: "ChatGPT", ua: "ChatGPT/1.2025.0" },
];

async function rpc(method, params, ua) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": ua,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const raw = await res.text();
  // Responses stream as SSE so headers flush before the tool finishes.
  const payload = /^(event|id|data|retry):/m.test(raw) ? sseData(raw) : raw;
  let body = null;
  let unparsed = null;
  try {
    body = JSON.parse(payload);
  } catch {
    // Something other than the server answered: a tunnel interstitial, a proxy
    // error page. Keep it so the caller can say so rather than reporting an
    // empty result, which reads like the server returned nothing.
    unparsed = payload;
  }
  return {
    status: res.status,
    wwwAuthenticate: res.headers.get("www-authenticate"),
    body,
    unparsed,
  };
}

/** Last SSE event's data payload; a stream may carry a priming event first. */
function sseData(raw) {
  const events = raw.split(/\r?\n\r?\n/).filter((e) => e.includes("data:"));
  const last = events[events.length - 1] ?? "";
  return last
    .split(/\r?\n/)
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

  const list = await rpc("tools/list", {}, ua);
  if (list.unparsed !== null) {
    console.log(`    tools/list: ${list.status}, but the body is not JSON. Something in front of`);
    console.log(`      the server answered: ${list.unparsed.slice(0, 120)}…`);
    return false;
  }
  if (list.body?.error) {
    console.log(`    tools/list: ${list.status} ${JSON.stringify(list.body.error)}`);
    return false;
  }
  const tools = list.body?.result?.tools ?? [];
  console.log(`    tools/list: ${list.status} anonymously, ${tools.length} tool(s)`);
  for (const tool of tools) {
    const schemes = (tool._meta?.securitySchemes ?? [])
      .map((s) => (s.type === "oauth2" ? `oauth2(${s.scopes?.join(" ")})` : s.type))
      .join(" + ");
    console.log(`      - ${tool.name}: ${schemes || "no securitySchemes advertised!"}`);
  }

  for (let i = 1; i <= MAX_CALLS; i++) {
    const res = await rpc(
      "tools/call",
      { name: "resolve-library-id", arguments: { query: "routing", libraryName: "react" } },
      ua
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

  console.log(`    no challenge in ${MAX_CALLS} calls. Is the backend reporting quota spent?`);
  return false;
}

async function checkDiscovery() {
  const origin = new URL(url).origin;
  console.log("\n=== OAuth discovery documents");
  for (const path of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]) {
    const res = await fetch(origin + path);
    let detail = "";
    if (res.ok) {
      try {
        const doc = await res.json();
        detail = ` -> authorization_servers=${JSON.stringify(doc.authorization_servers)}, resource=${doc.resource}`;
      } catch {
        detail = " -> not JSON (a proxy or tunnel answered, not the server)";
      }
    }
    console.log(`    ${path}: ${res.status}${detail}`);
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
    : "\nAt least one probe did not reach a challenge. See above."
);
process.exit(ok ? 0 : 1);
