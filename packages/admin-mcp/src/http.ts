import { createMcpHandler } from "@modelcontextprotocol/server";
import { filterBatchSelfCancellations } from "./batch.js";
import { createAdminServer, parseServerConfig, type RequestState } from "./server.js";

const ORIGIN = new URL(process.env.RESOURCE_URL || "https://admin.mcp.context7.com").origin;
export const MCP_PATH = "/mcp";
export const RESOURCE_URL = `${ORIGIN}${MCP_PATH}`;
export const METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
// Same Clerk issuer as packages/mcp.
export const OAUTH_AUTH_SERVER_URL = (
  process.env.OAUTH_AUTH_SERVER_URL || "https://clerk.context7.com"
).replace(/\/+$/, "");

/** RFC 9728 metadata: where an MCP client gets a token for this server. */
export function protectedResourceMetadata() {
  return {
    resource: RESOURCE_URL,
    authorization_servers: [OAUTH_AUTH_SERVER_URL],
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  };
}

/** HTTP 401 with the challenge that makes an MCP client start (or restart) OAuth. */
function challenge(errorDescription?: string): Response {
  const parameters = [`resource_metadata="${ORIGIN}${METADATA_PATH}"`];
  if (errorDescription) {
    parameters.unshift(`error="invalid_token"`, `error_description="${errorDescription}"`);
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32001, message: errorDescription ?? "Authentication required." },
      id: null,
    },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${parameters.join(", ")}` } }
  );
}

/**
 * The MCP endpoint as a web-standard handler. Every request needs a bearer (an
 * OAuth token or a `ctx7sk-` API key), which the tools forward unchanged to
 * the management API. The API is the only judge of the credential: when it
 * answers 401 during a tool call, this request is answered with HTTP 401, so
 * the client signs in again.
 */
export function createAdminHandler() {
  const mcp = createMcpHandler(
    (ctx) => createAdminServer(ctx.authInfo!.extra!.state as RequestState),
    {
      // No subscriptions and no streaming: every exchange is one finite answer.
      keepAliveMs: 0,
      maxSubscriptions: 0,
      responseMode: "json",
      onerror: (error) => console.error("MCP handler error:", error.message),
    }
  );

  return {
    close: () => mcp.close(),
    fetch: async (incoming: Request): Promise<Response> => {
      const authorization = incoming.headers.get("authorization") ?? "";
      if (!/^Bearer\s+\S/i.test(authorization)) return challenge();

      const request = await withoutSelfCancellations(incoming);
      if (!request) return new Response(null, { status: 202 });

      let config;
      try {
        config = parseServerConfig(new URL(request.url).searchParams);
      } catch (error) {
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32600, message: (error as Error).message }, id: null },
          { status: 400 }
        );
      }

      const state: RequestState = { authorization, config, authRejected: false };
      const response = await mcp.fetch(request, {
        authInfo: { token: authorization, clientId: "", scopes: [], extra: { state } },
      });
      // Read the whole answer before sending any of it: a tool call can still
      // learn that the credential is rejected, and then the status must be 401.
      // The legacy (2025) transport answers over SSE; its stream ends with the answer.
      const body = await response.arrayBuffer();
      if (state.authRejected) return challenge("The access token expired or is invalid");
      return new Response(body.byteLength > 0 ? body : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS,DELETE",
  "Access-Control-Allow-Headers":
    "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Authorization",
  // Browser clients need WWW-Authenticate to start OAuth from the 401.
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
};

/** Answers a CORS preflight, or adds the CORS headers to the route's answer. */
export async function withCors(
  request: Request,
  route: (request: Request) => Response | Promise<Response>
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  const response = await route(request);
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Clerk's metadata, for clients that only read the resource origin. */
export async function authorizationServerMetadata(): Promise<Response> {
  try {
    const upstream = await fetch(
      `${OAUTH_AUTH_SERVER_URL}/.well-known/oauth-authorization-server`,
      {
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!upstream.ok) {
      return Response.json(
        { error: "upstream_error", message: "Failed to fetch authorization server metadata" },
        { status: upstream.status }
      );
    }
    return Response.json(await upstream.json());
  } catch (error) {
    console.error("[OAuth] Error fetching OAuth metadata:", error);
    return Response.json(
      { error: "proxy_error", message: "Failed to proxy authorization server metadata" },
      { status: 502 }
    );
  }
}

/**
 * The request with legacy request/cancellation pairs removed from its batch,
 * or null when nothing is left to dispatch (answered 202). Only POST carries
 * messages; other methods keep the SDK's own handling.
 */
async function withoutSelfCancellations(request: Request): Promise<Request | null> {
  if (request.method !== "POST") return request;
  const text = await request.text();
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    message = undefined;
  }
  const filtered = filterBatchSelfCancellations(message);
  if (filtered.removedSelfCancellation && Array.isArray(filtered.body) && !filtered.body.length) {
    return null;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: "POST",
    headers,
    body: filtered.removedSelfCancellation ? JSON.stringify(filtered.body) : text,
    signal: request.signal,
  });
}
