import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { execSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { createDecipheriv } from "node:crypto";
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
const CLIENT_IP_ASSERTION_KEY = "0123456789abcdef".repeat(4);

function decryptClientIpAssertion(value: string): string {
  const [version, timestamp, nonceHex, ciphertextAndTagHex] = value.split(":");
  const ciphertextAndTag = Buffer.from(ciphertextAndTagHex, "hex");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(CLIENT_IP_ASSERTION_KEY, "hex"),
    Buffer.from(nonceHex, "hex")
  );
  decipher.setAAD(Buffer.from(`${version}:${timestamp}`, "utf8"));
  decipher.setAuthTag(ciphertextAndTag.subarray(-16));
  return Buffer.concat([
    decipher.update(ciphertextAndTag.subarray(0, -16)),
    decipher.final(),
  ]).toString("utf8");
}

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
  childEnv = {
    ...getDefaultEnvironment(),
    CONTEXT7_API_URL: stubUrl,
    MCP_CLIENT_IP_ASSERTION_KEY: CLIENT_IP_ASSERTION_KEY,
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
          requestInit: {
            headers: {
              "user-agent": "ua-fallback/9.9.9",
              "x-forwarded-for": "attacker-selected-bucket, 203.0.113.77",
            },
          },
        })
      : new StdioClientTransport({ command: process.execPath, args: [DIST], env: childEnv });
  await client.connect(transport);
  return client;
}

describe("OAuth discovery", () => {
  test("advertises Clerk for user OAuth and Context7 for enterprise auth", async () => {
    const metadataUrl = new URL("/.well-known/oauth-protected-resource", httpUrl);
    const response = await fetch(metadataUrl);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "https://mcp.context7.com",
      authorization_servers: ["https://clerk.context7.com", "https://context7.com"],
    });
  });

  test("advertises only the EMA issuer for the path-bound EMA resource", async () => {
    const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp/ema", httpUrl);
    const response = await fetch(metadataUrl);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: "https://mcp.context7.com/mcp/ema",
      authorization_servers: ["https://context7.com"],
      scopes_supported: ["profile", "email"],
      bearer_methods_supported: ["header"],
    });
  });

  test("challenges unauthenticated EMA requests with the path-bound metadata URL", async () => {
    const response = await fetch(new URL("/mcp/ema", httpUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.context7.com/.well-known/oauth-protected-resource/mcp/ema"'
    );
  });

  test("rejects opaque bearer credentials on the EMA endpoint", async () => {
    const response = await fetch(new URL("/mcp/ema", httpUrl), {
      method: "POST",
      headers: {
        authorization: "Bearer not-an-ema-token",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { message: "EMA access token required" },
    });
  });
});

describe("HTTP API key headers", () => {
  test("accepts the advertised X-Context7-API-Key header", async () => {
    const apiKey = "ctx7sk-advertised-header-test";
    const client = new Client({ name: "api-key-header-test", version: "1.0.0" });

    await client.connect(
      new StreamableHTTPClientTransport(new URL(httpUrl), {
        requestInit: { headers: { "X-Context7-API-Key": apiKey } },
      })
    );

    try {
      requests.length = 0;
      await client.callTool({
        name: "query-docs",
        arguments: { libraryId: "/vercel/next.js", query: "app router" },
      });

      const apiCall = requests.find((request) => request.path === "/v2/context");
      expect(apiCall?.headers.authorization).toBe(`Bearer ${apiKey}`);
    } finally {
      await client.close();
    }
  });
});

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
    if (transportKind === "http") {
      expect(apiCalls[0].headers["mcp-client-ip-assertion"]).toMatch(/^v1:/);
      expect(
        decryptClientIpAssertion(apiCalls[0].headers["mcp-client-ip-assertion"] as string)
      ).toBe("203.0.113.77");
      expect(apiCalls[0].headers["mcp-client-ip"]).toBeUndefined();
    } else {
      expect(apiCalls[0].headers["mcp-client-ip-assertion"]).toBeUndefined();
    }
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
