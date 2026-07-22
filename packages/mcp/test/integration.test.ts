import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { execSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

// End-to-end tests: the real built binary (dist/index.js) is exercised over
// both transports (spawned HTTP server, spawned stdio child) by both protocol
// eras (modern 2026-07-28 pinned, legacy 2025 handshake). The Context7 API is
// stubbed with a local HTTP server via CONTEXT7_API_URL, which also records
// requests so arg aliasing and client-info propagation can be asserted at the
// wire.

const PKG_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = path.join(PKG_ROOT, "dist", "index.js");
const BASE_PORT = 43117;
const STUB_DOCS = "stub docs text";

interface RecordedRequest {
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
}

const requests: RecordedRequest[] = [];
let stubServer: http.Server;
let childEnv: Record<string, string>;
let httpChild: ChildProcess;
let httpUrl: string;

function startStubApi(): Promise<string> {
  stubServer = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://stub.local");
    const apiPath = url.pathname.replace(/^\/api/, "");
    requests.push({ path: apiPath, query: url.searchParams, headers: req.headers });
    if (apiPath === "/v2/libs/search") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          results: [
            {
              id: "/vercel/next.js",
              title: "Next.js",
              description: "The React Framework",
              branch: "main",
              lastUpdateDate: "2026-01-01",
              state: "finalized",
              totalTokens: 100,
              totalSnippets: 10,
            },
          ],
        })
      );
    } else if (apiPath === "/v2/context") {
      res.setHeader("Content-Type", "text/plain");
      res.end(STUB_DOCS);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve) => {
    stubServer.listen(0, "127.0.0.1", () => {
      const address = stubServer.address() as { port: number };
      resolve(`http://127.0.0.1:${address.port}/api`);
    });
  });
}

function startHttpChild(): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DIST, "--transport", "http", "--port", String(BASE_PORT)],
      { env: childEnv, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // The binary retries on EADDRINUSE, so parse the actual port it settled on.
      const match = stderr.match(/running on HTTP at (http:\/\/localhost:\d+\/mcp)/);
      if (match) resolve({ child, url: match[1] });
    });
    child.once("exit", (code) => {
      reject(new Error(`HTTP server exited before listening (code ${code}): ${stderr}`));
    });
  });
}

beforeAll(async () => {
  execSync("pnpm build", { cwd: PKG_ROOT, stdio: "pipe" });
  const stubUrl = await startStubApi();
  // getDefaultEnvironment() inherits only safe vars, so a real
  // CONTEXT7_API_KEY in the parent shell cannot leak into the children.
  childEnv = { ...getDefaultEnvironment(), CONTEXT7_API_URL: stubUrl };
  ({ child: httpChild, url: httpUrl } = await startHttpChild());
}, 120_000);

afterAll(() => {
  httpChild?.kill();
  stubServer?.close();
});

async function connect(transportKind: "http" | "stdio", era: "modern" | "legacy") {
  const client = new Client(
    { name: "test-harness", version: "1.0.0" },
    era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : undefined
  );
  const transport =
    transportKind === "http"
      ? new StreamableHTTPClientTransport(new URL(httpUrl), {
          // Parseable UA so the legacy-HTTP fallback path (no protocol client
          // info) is observable; modern clients must beat it via the envelope.
          requestInit: { headers: { "user-agent": "ua-fallback/9.9.9" } },
        })
      : new StdioClientTransport({ command: process.execPath, args: [DIST], env: childEnv });
  await client.connect(transport);
  return client;
}

describe.each([
  ["http", "modern"],
  ["http", "legacy"],
  ["stdio", "modern"],
  ["stdio", "legacy"],
] as const)("%s transport, %s client", (transportKind, era) => {
  let client: Client;

  beforeAll(async () => {
    client = await connect(transportKind, era);
  }, 15_000);

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    requests.length = 0;
  });

  test("negotiates the expected protocol era", () => {
    expect(client.getProtocolEra()).toBe(era);
  });

  test("lists both tools with derived input schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["query-docs", "resolve-library-id"]);

    // The z.preprocess wrapper must not break JSON Schema derivation.
    const resolve = tools.find((t) => t.name === "resolve-library-id")!;
    expect(Object.keys(resolve.inputSchema.properties ?? {}).sort()).toEqual([
      "libraryName",
      "query",
    ]);
    const queryDocs = tools.find((t) => t.name === "query-docs")!;
    expect(Object.keys(queryDocs.inputSchema.properties ?? {}).sort()).toEqual([
      "libraryId",
      "query",
    ]);
  });

  test("calls query-docs end to end", async () => {
    const result = await client.callTool({
      name: "query-docs",
      arguments: { libraryId: "/vercel/next.js", query: "app router" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toMatchObject([{ type: "text", text: STUB_DOCS }]);

    const apiCalls = requests.filter((r) => r.path === "/v2/context");
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].query.get("libraryId")).toBe("/vercel/next.js");
    expect(apiCalls[0].query.get("query")).toBe("app router");
    expect(apiCalls[0].headers["x-context7-transport"]).toBe(transportKind);
  });

  test("calls resolve-library-id end to end", async () => {
    const result = await client.callTool({
      name: "resolve-library-id",
      arguments: { query: "next.js docs", libraryName: "Next.js" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(text).toContain("Available Libraries");
    expect(text).toContain("/vercel/next.js");
  });

  test("rewrites hallucinated argument aliases before validation", async () => {
    const result = await client.callTool({
      name: "query-docs",
      // Both keys are aliases: libraryName -> libraryId, userQuery -> query.
      arguments: { libraryName: "/vercel/next.js", userQuery: "app router" },
    });
    expect(result.isError).toBeFalsy();

    const apiCalls = requests.filter((r) => r.path === "/v2/context");
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].query.get("libraryId")).toBe("/vercel/next.js");
    expect(apiCalls[0].query.get("query")).toBe("app router");
  });

  test("propagates client info to the Context7 API", async () => {
    await client.callTool({
      name: "query-docs",
      arguments: { libraryId: "/vercel/next.js", query: "app router" },
    });
    const apiCall = requests.find((r) => r.path === "/v2/context")!;
    // Legacy HTTP is the only combo with no protocol-level client info: it
    // falls back to parsing the User-Agent header. Everywhere else the MCP
    // client identity wins (initialize handshake on legacy stdio, per-request
    // _meta envelope on modern — which must override the UA fallback on HTTP).
    const expected =
      transportKind === "http" && era === "legacy"
        ? { ide: "ua-fallback", version: "9.9.9" }
        : { ide: "test-harness", version: "1.0.0" };
    expect(apiCall.headers["x-context7-client-ide"]).toBe(expected.ide);
    expect(apiCall.headers["x-context7-client-version"]).toBe(expected.version);
  });
});
