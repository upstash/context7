import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

export const SERVER_VERSION: string = pkg.version;

const CONTEXT7_BASE_URL = "https://context7.com";
const MCP_RESOURCE_URL = "https://mcp.context7.com";
const DEFAULT_OAUTH_AUTH_SERVER_URL = "https://clerk.context7.com";

export const CONTEXT7_API_BASE_URL = process.env.CONTEXT7_API_URL || `${CONTEXT7_BASE_URL}/api`;
export const RESOURCE_URL = process.env.RESOURCE_URL || MCP_RESOURCE_URL;

/**
 * Canonical MCP resource identifier (RFC 8707 / RFC 9728). Clients connect at
 * `{origin}/mcp`, so origin-only RESOURCE_URL values get `/mcp` appended. JWT
 * audience validation still uses RESOURCE_URL so existing origin-scoped EMA
 * tokens keep working.
 */
export function canonicalMcpResourceUrl(resourceUrl = RESOURCE_URL): string {
  const url = new URL(resourceUrl);
  const path = url.pathname === "/" || url.pathname === "" ? "/mcp" : url.pathname;
  return `${url.origin}${path}`.replace(/\/+$/, "");
}

/** RFC 9728 well-known path for the canonical MCP resource (path inserted). */
export function protectedResourceMetadataPath(resourceUrl = RESOURCE_URL): string {
  const resource = new URL(canonicalMcpResourceUrl(resourceUrl));
  const suffix = resource.pathname === "/" ? "" : resource.pathname;
  return `/.well-known/oauth-protected-resource${suffix}`;
}

// Clerk owns the interactive OAuth flow and is the issuer returned in the
// authorization response. Advertising Clerk directly keeps RFC 8414 discovery
// and RFC 9207 response-issuer validation on the same authorization-server
// identity.
export const OAUTH_AUTH_SERVER_URL = (
  process.env.OAUTH_AUTH_SERVER_URL || DEFAULT_OAUTH_AUTH_SERVER_URL
).replace(/\/+$/, "");
export const OAUTH_JWKS_URL =
  process.env.OAUTH_JWKS_URL || `${OAUTH_AUTH_SERVER_URL}/.well-known/jwks.json`;

// Enterprise-Managed Auth (id-jag): access tokens minted by the Context7
// authorization server, validated against its public JWKS.
// AUTH_SERVER_URL remains a backwards-compatible alias for local EMA setups;
// it does not move interactive user OAuth. Local end-to-end OAuth environments
// must set OAUTH_AUTH_SERVER_URL separately when Clerk is not the intended issuer.
export const EMA_ISSUER =
  process.env.EMA_ISSUER || process.env.AUTH_SERVER_URL || CONTEXT7_BASE_URL;
export const EMA_JWKS_URL = process.env.EMA_JWKS_URL || `${CONTEXT7_API_BASE_URL}/oauth/ema-jwks`;
export const OPENAI_APPS_CHALLENGE_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN;

/** Describe authorization for the canonical MCP resource. */
export function protectedResourceMetadataDocument(resourceUrl = RESOURCE_URL) {
  return {
    resource: canonicalMcpResourceUrl(resourceUrl),
    authorization_servers: Array.from(new Set([OAUTH_AUTH_SERVER_URL, EMA_ISSUER])),
    scopes_supported: ["profile", "email"],
    bearer_methods_supported: ["header"],
  };
}

/** Describe the remote server using the experimental Server Card v1 schema. */
export function mcpServerCard(resourceUrl = RESOURCE_URL) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "io.github.upstash/context7",
    title: "Context7",
    description: "Current documentation and code examples for software libraries and frameworks.",
    version: SERVER_VERSION,
    remotes: [
      {
        type: "streamable-http",
        url: canonicalMcpResourceUrl(resourceUrl),
      },
    ],
  };
}
