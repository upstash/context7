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
const EMPTY_CONTEXT_QUERY = "force-empty-context";
const NO_RESULTS_QUERY = "force-no-results";
const UPSTREAM_ERROR_QUERY = "force-upstream-error";
const INVALID_JSON_QUERY = "force-invalid-json";

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
let metricsUrl: string;

function operationCount(exported: string, method: string): number {
  return exported
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("mcp_server_operation_duration_count{") &&
        line.includes(`mcp_method_name="${method}"`)
    )
    .reduce((total, line) => total + Number(line.slice(line.lastIndexOf(" ") + 1)), 0);
}

function getFreePort(): Promise<number> {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function startStubApi(): Promise<string> {
  stubServer = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://stub.local");
    const apiPath = url.pathname.replace(/^\/api/, "");
    requests.push({ path: apiPath, query: url.searchParams, headers: req.headers });
    if (apiPath === "/v2/libs/search") {
      res.setHeader("Content-Type", "application/json");
      if (url.searchParams.get("query") === INVALID_JSON_QUERY) {
        res.end("not-json");
        return;
      }
      if (url.searchParams.get("query") === NO_RESULTS_QUERY) {
        res.end(JSON.stringify({ results: [] }));
        return;
      }
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
      if (url.searchParams.get("query") === UPSTREAM_ERROR_QUERY) {
        res.statusCode = 503;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ message: "stub upstream failure" }));
        return;
      }
      res.setHeader("Content-Type", "text/plain");
      res.end(url.searchParams.get("query") === EMPTY_CONTEXT_QUERY ? "" : STUB_DOCS);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    const handleListenError = (error: Error) => {
      stubServer.close();
      reject(error);
    };
    stubServer.once("error", handleListenError);
    stubServer.listen(0, "127.0.0.1", () => {
      stubServer.off("error", handleListenError);
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
  const metricsPort = await getFreePort();
  metricsUrl = `http://127.0.0.1:${metricsPort}/metrics`;
  // getDefaultEnvironment() inherits only safe vars, so a real
  // CONTEXT7_API_KEY in the parent shell cannot leak into the children.
  childEnv = {
    ...getDefaultEnvironment(),
    CONTEXT7_API_URL: stubUrl,
    OTEL_EXPORTER_PROMETHEUS_HOST: "127.0.0.1",
    OTEL_EXPORTER_PROMETHEUS_PORT: String(metricsPort),
  };
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

  // The declared `capabilities: { prompts: {}, resources: {} }` replaced three
  // hand-written empty-list handlers; clients that call these unconditionally
  // must still get an empty collection rather than "method not found".
  test("answers prompts/resources list requests with empty collections", async () => {
    expect((await client.listPrompts()).prompts).toEqual([]);
    expect((await client.listResources()).resources).toEqual([]);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
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

describe("OpenTelemetry metrics", () => {
  test("counts each dispatched operation in a legacy JSON-RPC batch", async () => {
    const before = operationCount(await (await fetch(metricsUrl)).text(), "tools/list");
    const response = await fetch(httpUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 90_001, method: "tools/list", params: {} },
        { jsonrpc: "2.0", id: 90_002, method: "tools/list", params: {} },
      ]),
    });
    expect(response.status).toBe(200);
    await response.text();

    const after = operationCount(await (await fetch(metricsUrl)).text(), "tools/list");
    expect(after - before).toBe(2);
  });

  test("exports bounded MCP, tool, upstream, and authentication metrics", async () => {
    const client = await connect("http", "modern");
    try {
      await client.callTool({
        name: "query-docs",
        arguments: { libraryId: "/vercel/next.js", query: "app router" },
      });
      await client.callTool({
        name: "query-docs",
        arguments: { libraryId: "/vercel/next.js", query: UPSTREAM_ERROR_QUERY },
      });
      await client.callTool({
        name: "resolve-library-id",
        arguments: { libraryName: "Next.js", query: INVALID_JSON_QUERY },
      });
      await client.callTool({
        name: "resolve-library-id",
        arguments: { libraryName: "does-not-exist", query: NO_RESULTS_QUERY },
      });
      await client.callTool({
        name: "query-docs",
        arguments: { libraryId: "/missing/library", query: EMPTY_CONTEXT_QUERY },
      });
    } finally {
      await client.close();
    }

    const protectedUrl = new URL(httpUrl);
    protectedUrl.pathname = "/mcp/oauth";
    const unauthorizedResponse = await fetch(protectedUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-method": "initialize" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(unauthorizedResponse.status).toBe(401);

    const acceptedResponse = await fetch(protectedUrl, {
      method: "DELETE",
      headers: { authorization: "Bearer ctx7sk-local-test" },
    });
    expect(acceptedResponse.status).toBe(405);
    await acceptedResponse.text();

    let exported = "";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch(metricsUrl);
      expect(response.status).toBe(200);
      exported = await response.text();
      if (exported.includes("nodejs_eventloop_utilization")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const operationCounts = exported
      .split("\n")
      .filter((line) => line.startsWith("mcp_server_operation_duration_count{"));
    expect(
      operationCounts.some(
        (line) =>
          line.includes('mcp_method_name="tools/call"') &&
          line.includes('gen_ai_tool_name="query-docs"') &&
          !line.includes("error_type=")
      )
    ).toBe(true);
    expect(
      operationCounts
        .filter((line) => line.includes('mcp_method_name="tools/call"'))
        .every((line) => !line.includes('error_type="connection_closed"'))
    ).toBe(true);
    expect(
      operationCounts.some(
        (line) =>
          line.includes('mcp_method_name="tools/call"') &&
          line.includes('gen_ai_tool_name="query-docs"') &&
          line.includes('error_type="tool_error"')
      )
    ).toBe(true);
    expect(
      operationCounts.some(
        (line) =>
          line.includes('gen_ai_tool_name="query-docs"') &&
          line.includes('context7_mcp_tool_outcome="success"')
      )
    ).toBe(true);
    expect(exported).toMatch(
      /context7_mcp_upstream_requests_total\{[^}]*context7_upstream_operation="fetch_context"[^}]*context7_upstream_outcome="success"[^}]*\} [1-9]/
    );
    expect(
      operationCounts.some(
        (line) =>
          line.includes('gen_ai_tool_name="query-docs"') &&
          line.includes('context7_mcp_tool_outcome="error"')
      )
    ).toBe(true);
    expect(
      operationCounts.some((line) => line.includes('context7_mcp_tool_outcome="not_found"'))
    ).toBe(true);
    expect(exported).toMatch(
      /context7_mcp_upstream_requests_total\{[^}]*context7_upstream_operation="fetch_context"[^}]*http_response_status_code_class="5xx"[^}]*context7_upstream_outcome="http_error"[^}]*\} [1-9]/
    );
    expect(exported).toMatch(
      /context7_mcp_upstream_requests_total\{[^}]*context7_upstream_operation="search_libraries"[^}]*http_response_status_code_class="2xx"[^}]*context7_upstream_outcome="response_error"[^}]*\} [1-9]/
    );
    expect(
      exported
        .split("\n")
        .some(
          (line) =>
            line.startsWith("context7_mcp_upstream_requests_total{") &&
            line.includes('context7_upstream_operation="fetch_context"') &&
            line.includes('http_response_status_code="503"')
        )
    ).toBe(true);
    expect(exported).toMatch(
      /context7_mcp_authentication_attempts_total\{[^}]*context7_authentication_outcome="missing"[^}]*\} 1/
    );
    expect(exported).toMatch(
      /context7_mcp_authentication_attempts_total\{[^}]*context7_authentication_outcome="accepted"[^}]*\} 1/
    );
    expect(exported).toContain("context7_mcp_authentication_duration_count");
    expect(exported).toContain("context7_mcp_authentication_active");
    expect(exported).toContain("mcp_server_operation_duration_bucket");
    expect(exported).toMatch(/target_info\{[^}]*service_name="context7-mcp"/);
    expect(exported).toContain("v8js_memory_heap_used");
    expect(exported).toContain("nodejs_eventloop_utilization");
    expect(exported).not.toContain("mcp_server_session_duration");

    expect(exported).not.toMatch(/(?:\{|,)(?:api_key|client_ip|library_id|query|session_id)="/i);

    const activeSamples = exported
      .split("\n")
      .filter((line) => /^context7_mcp_.*_active\{/.test(line));
    expect(activeSamples.length).toBeGreaterThan(0);
    expect(activeSamples.every((line) => line.endsWith(" 0"))).toBe(true);

    const applicationMetricsResponse = await fetch(new URL("/metrics", httpUrl));
    expect(applicationMetricsResponse.status).toBe(404);
  });

  test("continues serving when the embedded exporter port is occupied", async () => {
    const secondServer = await startHttpChild();
    try {
      const pingUrl = new URL(secondServer.url);
      pingUrl.pathname = "/ping";
      const response = await fetch(pingUrl);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: "ok" });
    } finally {
      secondServer.child.kill();
    }
  });
});
