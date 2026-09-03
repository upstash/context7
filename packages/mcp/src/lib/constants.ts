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
export const EMA_RESOURCE_URL = `${MCP_RESOURCE_URL}/mcp/ema`;

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
