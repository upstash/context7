// RFC 9728 metadata: where an MCP client gets a token for this server (Vercel's mcp-handler).
import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { OAUTH_AUTH_SERVER_URL, RESOURCE_URL, withCors } from "../src/http.js";

/**
 * `scopes_supported` is required in practice: a client without it asks for
 * every scope Clerk lists, and Clerk refuses `openid` for MCP clients with
 * `invalid_scope`, so the sign-in fails.
 */
export const metadata = generateProtectedResourceMetadata({
  authServerUrls: [OAUTH_AUTH_SERVER_URL],
  resourceUrl: RESOURCE_URL,
  additionalMetadata: {
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  },
});
const preflight = metadataCorsOptionsRequestHandler();

export default {
  fetch: (request: Request) =>
    request.method === "OPTIONS" ? preflight() : withCors(request, () => Response.json(metadata)),
};
