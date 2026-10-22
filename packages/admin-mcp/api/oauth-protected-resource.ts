// RFC 9728 metadata: where an MCP client gets a token for this server (Vercel's mcp-handler).
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { OAUTH_AUTH_SERVER_URL, RESOURCE_URL } from "../src/http.js";

const metadata = protectedResourceHandler({
  authServerUrls: [OAUTH_AUTH_SERVER_URL],
  resourceUrl: RESOURCE_URL,
});
const preflight = metadataCorsOptionsRequestHandler();

export default {
  fetch: (request: Request) => (request.method === "OPTIONS" ? preflight() : metadata(request)),
};
