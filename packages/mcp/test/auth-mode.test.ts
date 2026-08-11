import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Covers the shipped default of the public `/mcp` endpoint: an anonymous client
 * is challenged on its very first request, so its OAuth flow runs at connect
 * time rather than failing a tool call mid-conversation.
 *
 * Drives the built binary over raw HTTP rather than an MCP client, because the
 * contract under test is the transport-level status and the `WWW-Authenticate`
 * header, both of which a client library hides.
 */

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");
// Distinct from integration.test.ts's range; the binary retries on EADDRINUSE
// and reports the port it settled on, which is what we parse below.
const BASE_PORT = 39217;

let child: ChildProcess;
let url: string;

function startServer(env: Record<string, string>): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [DIST, "--transport", "http", "--port", String(BASE_PORT)],
      {
        env: { ...process.env, ...env } as NodeJS.ProcessEnv,
        stdio: ["ignore", "ignore", "pipe"],
      }
    );
    let stderr = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/running on HTTP at (http:\/\/localhost:\d+\/mcp)/);
      if (match) resolve({ child: proc, url: match[1] });
    });
    proc.on("exit", (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
    setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 30_000);
  });
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, wwwAuthenticate: res.headers.get("www-authenticate") };
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
};

beforeAll(async () => {
  // No CONTEXT7_MCP_AUTH_MODE: exercise the shipped default.
  ({ child, url } = await startServer({ CONTEXT7_API_URL: "http://127.0.0.1:1/api" }));
}, 60_000);

afterAll(() => child?.kill());

describe("/mcp default auth mode", () => {
  test("challenges an anonymous initialize, so the client authenticates at connect time", async () => {
    const res = await post(INITIALIZE);
    expect(res.status).toBe(401);
    expect(res.wwwAuthenticate).toContain('error="invalid_token"');
    expect(res.wwwAuthenticate).toContain("/.well-known/oauth-protected-resource");
    expect(res.wwwAuthenticate).toContain('scope="profile email"');
  });

  test("challenges tools/list too, not just tool calls", async () => {
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(res.status).toBe(401);
  });

  test("a credential gets past the gate", async () => {
    // The upstream API is unreachable in this test, so the tool result is an
    // error — but the request is no longer refused at the transport layer,
    // which is what the gate controls.
    const res = await post(INITIALIZE, { "CONTEXT7-API-KEY": "ctx7sk-test" });
    expect(res.status).toBe(200);
  });

  test("the discovery document is served without authentication", async () => {
    const origin = new URL(url).origin;
    const res = await fetch(`${origin}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { authorization_servers: string[] };
    expect(doc.authorization_servers.length).toBeGreaterThan(0);
  });
});
