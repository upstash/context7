import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

export const SERVER_VERSION: string = pkg.version;

const CONTEXT7_BASE_URL = "https://context7.com";
const MCP_RESOURCE_URL = "https://mcp.context7.com";

export const CLERK_DOMAIN = "clerk.context7.com";
export const CONTEXT7_API_BASE_URL = process.env.CONTEXT7_API_URL || `${CONTEXT7_BASE_URL}/api`;
export const RESOURCE_URL = process.env.RESOURCE_URL || MCP_RESOURCE_URL;
export const AUTH_SERVER_URL = process.env.AUTH_SERVER_URL || CONTEXT7_BASE_URL;
