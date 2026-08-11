// Stands in for context7app's /api/v2 surface so the lazy-auth handover can be
// exercised without spending a real monthly quota.
//
// By default it proxies to the real Context7 API and rewrites only
// `RateLimit-Remaining`, so tools return genuine documentation and the only
// thing under your control is when the free requests run out. That is what you
// want for a demo. Set UPSTREAM=none to serve canned responses instead, for
// running offline.
//
//   FREE_CALLS=3 node scripts/quota-stub-backend.mjs
//   CONTEXT7_API_URL=http://localhost:3099/api node dist/index.js --transport http --port 3000
//
// Env: PORT (3099), FREE_CALLS (2), UPSTREAM (https://context7.com, or "none").
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3099);
const UPSTREAM = process.env.UPSTREAM ?? "https://context7.com";
const LIMIT = Number(process.env.STUB_LIMIT ?? 200);
const RESET = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

let remaining = Number(process.env.FREE_CALLS ?? process.env.STUB_REMAINING ?? 2);

/** The headers context7app's middleware attaches to every quota-counted response. */
function quotaHeaders() {
  return {
    "RateLimit-Limit": String(LIMIT),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(RESET),
    "Context7-Quota-Tier": "anonymous",
  };
}

function spend() {
  if (remaining > 0) remaining -= 1;
  return remaining;
}

const CANNED = {
  search: {
    results: [
      {
        id: "/vercel/next.js",
        title: "Next.js",
        description: "canned result (UPSTREAM=none)",
        branch: "main",
        lastUpdateDate: "2026-01-01",
        state: "finalized",
        totalTokens: 1,
        totalSnippets: 1,
      },
    ],
  },
  context: "canned documentation (UPSTREAM=none)",
};

createServer(async (req, res) => {
  const path = req.url.split("?")[0];

  // Out of free requests: answer exactly as the backend does once the monthly
  // anonymous quota is spent.
  if (remaining <= 0) {
    console.log(`${path} -> 429 (free requests spent)`);
    res.writeHead(429, { "Content-Type": "application/json", ...quotaHeaders() });
    res.end(
      JSON.stringify({
        error: "Quota Exceeded",
        message:
          "Monthly quota exceeded. Create a free API key at https://context7.com/dashboard for more requests.",
      })
    );
    return;
  }

  if (UPSTREAM === "none") {
    spend();
    console.log(`${path} -> 200 canned (remaining now ${remaining})`);
    res.writeHead(200, { "Content-Type": "application/json", ...quotaHeaders() });
    res.end(
      JSON.stringify(path.endsWith("/v2/libs/search") ? CANNED.search : { data: CANNED.context })
    );
    return;
  }

  try {
    const upstream = await fetch(UPSTREAM + req.url, {
      headers: { "X-Context7-Source": "mcp-server" },
    });
    const body = await upstream.text();
    spend();

    // Drop hop-by-hop and length headers (the body is re-sent decoded), and the
    // upstream's own quota headers — otherwise they survive alongside the
    // rewritten ones under different casing and the client reads both.
    const DROP = new Set([
      "content-encoding",
      "content-length",
      "transfer-encoding",
      "connection",
      "ratelimit-limit",
      "ratelimit-remaining",
      "ratelimit-reset",
      "context7-quota-tier",
    ]);
    const headers = Object.fromEntries(
      [...upstream.headers].filter(([name]) => !DROP.has(name.toLowerCase()))
    );
    console.log(`${path} -> ${upstream.status} proxied (remaining now ${remaining})`);
    res.writeHead(upstream.status, { ...headers, ...quotaHeaders() });
    res.end(body);
  } catch (error) {
    console.error(`${path} -> upstream error:`, error.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream_error", message: String(error) }));
  }
}).listen(PORT, () => {
  const mode = UPSTREAM === "none" ? "canned responses" : `proxying ${UPSTREAM}`;
  console.log(`quota stub on :${PORT} — ${mode}, ${remaining} free request(s) then 429`);
});
