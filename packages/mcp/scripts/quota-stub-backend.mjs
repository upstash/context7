// Stub of context7app's /api/v2 surface, emitting the exact quota headers the
// real middleware attaches (createQuotaHeaders / createMonthlyQuota429Response).
// REMAINING is decremented per request so we can watch the handover.
import { createServer } from "node:http";

let remaining = Number(process.env.STUB_REMAINING ?? 2);
const LIMIT = Number(process.env.STUB_LIMIT ?? 200);
const RESET = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const quotaHeaders = {
    "RateLimit-Limit": String(LIMIT),
    "RateLimit-Remaining": String(Math.max(0, remaining)),
    "RateLimit-Reset": String(RESET),
    "Context7-Quota-Tier": "anonymous",
  };

  if (remaining <= 0) {
    console.log(`${url.pathname} -> 429 (quota spent)`);
    res.writeHead(429, { "Content-Type": "application/json", ...quotaHeaders });
    res.end(JSON.stringify({ error: "Quota Exceeded", message: "Monthly quota exceeded." }));
    return;
  }

  remaining -= 1;
  quotaHeaders["RateLimit-Remaining"] = String(Math.max(0, remaining));
  console.log(`${url.pathname} -> 200 (remaining now ${quotaHeaders["RateLimit-Remaining"]})`);

  res.writeHead(200, { "Content-Type": "application/json", ...quotaHeaders });
  if (url.pathname.endsWith("/v2/libs/search")) {
    res.end(
      JSON.stringify({
        results: [
          {
            id: "/vercel/next.js",
            title: "Next.js",
            description: "stub",
            branch: "main",
            lastUpdateDate: "2026-01-01",
            state: "finalized",
            totalTokens: 1,
            totalSnippets: 1,
          },
        ],
      })
    );
  } else {
    res.end(JSON.stringify({ data: "stub docs" }));
  }
}).listen(3099, () => console.log("stub backend on :3099"));
