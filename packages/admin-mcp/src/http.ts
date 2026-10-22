import {
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { filterBatchSelfCancellations } from "./batch.js";
import { registerAdminTools, SERVER_OPTIONS, type RequestState } from "./server.js";

const ORIGIN = new URL(process.env.RESOURCE_URL || "https://admin.mcp.context7.com").origin;
export const MCP_PATH = "/mcp";
export const RESOURCE_URL = `${ORIGIN}${MCP_PATH}`;
export const METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;
// Same Clerk issuer as packages/mcp.
export const OAUTH_AUTH_SERVER_URL = (
  process.env.OAUTH_AUTH_SERVER_URL || "https://clerk.context7.com"
).replace(/\/+$/, "");

const RESOURCE_METADATA_URL = `${ORIGIN}${METADATA_PATH}`;

/**
 * The MCP endpoint as a web-standard handler, built with Vercel's mcp-handler.
 *
 * - `withMcpAuth` answers a request without a bearer with the challenge that
 *   starts OAuth. Any bearer passes it: an OAuth token or a `ctx7sk-` API key
 *   goes on unchanged to the management API, which is its only judge.
 * - When the API rejects the credential during a tool call, this request is
 *   answered with HTTP 401 as well, so the client signs in again.
 */
export function createAdminHandler() {
  const mcp = createMcpHandler(registerAdminTools, {
    ...SERVER_OPTIONS,
    onEvent: (event) => {
      if (event.type === "ERROR") console.error("MCP handler error:", event.error);
    },
  });

  return async (incoming: Request): Promise<Response> => {
    const request = await withoutSelfCancellations(incoming);
    if (!request) return new Response(null, { status: 202 });

    const state: RequestState = {
      authorization: request.headers.get("authorization") ?? "",
      authRejected: false,
    };
    const authed = withMcpAuth(
      mcp,
      async (_request, token) =>
        token ? { token, clientId: "", scopes: [], extra: { state } } : undefined,
      { required: true, resourceUrl: ORIGIN, resourceMetadataPath: METADATA_PATH }
    );
    const response = await authed(request);
    // Read the whole answer before sending any of it: a tool call can still
    // learn that the credential is rejected, and then the status must be 401.
    const body = await response.arrayBuffer();
    if (state.authRejected) {
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InvalidToken, "The access token expired or is invalid"),
        { resourceMetadataUrl: RESOURCE_METADATA_URL }
      );
    }
    return new Response(body.byteLength > 0 ? body : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
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
