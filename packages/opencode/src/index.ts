import { fileURLToPath } from "node:url";
import type { Config, Plugin, PluginModule } from "@opencode-ai/plugin";

const MCP_BASE_URL = "https://mcp.context7.com";

/** An API key travels as an `Authorization` header against the plain endpoint. */
const MCP_URL = `${MCP_BASE_URL}/mcp`;

/** `/mcp/oauth` answers with a 401 and OAuth metadata, which triggers OpenCode's OAuth flow. */
const MCP_OAUTH_URL = `${MCP_BASE_URL}/mcp/oauth`;

const MCP_SERVER_NAME = "context7";

export interface Context7PluginOptions {
  /** Context7 API key. Falls back to the `CONTEXT7_API_KEY` environment variable. */
  apiKey?: string;
}

/** OpenCode's `Config` type does not declare `skills` yet, but the config schema accepts it. */
type ConfigWithSkills = Config & {
  skills?: { paths?: string[]; urls?: string[] };
};

/**
 * Absolute path to the skill folders shipped with this package.
 *
 * The build emits `dist/index.js`, so the bundled `skills` directory sits one level up.
 * OpenCode resolves relative skill paths against the project directory, and this package
 * lives outside the project, so the path has to be absolute and resolved at runtime.
 */
const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Adds the Context7 MCP server and the bundled skill to the resolved config.
 *
 * Both entries are additive. An existing entry under the same key always wins, so a user
 * who configures Context7 by hand keeps their own settings.
 */
function applyContext7Config(config: Config, apiKey: string | undefined): void {
  config.mcp ??= {};
  config.mcp[MCP_SERVER_NAME] ??= apiKey
    ? {
        type: "remote",
        url: MCP_URL,
        enabled: true,
        headers: { Authorization: `Bearer ${apiKey}` },
        oauth: false,
      }
    : { type: "remote", url: MCP_OAUTH_URL, enabled: true };

  const withSkills = config as ConfigWithSkills;
  withSkills.skills ??= {};
  const skillPaths = (withSkills.skills.paths ??= []);
  if (!skillPaths.includes(SKILLS_DIR)) {
    skillPaths.push(SKILLS_DIR);
  }
}

/**
 * Context7 plugin for OpenCode.
 *
 * Registers the hosted Context7 MCP server and the `context7-mcp` skill.
 */
const Context7Plugin: Plugin = async (_input, options) => {
  const apiKey = nonEmptyString(options?.apiKey) ?? nonEmptyString(process.env.CONTEXT7_API_KEY);

  return {
    config: async (config) => {
      applyContext7Config(config, apiKey);
    },
  };
};

/**
 * OpenCode reads the default export. Anything else exported from this module would be
 * treated as a second plugin by the legacy loader, so keep the default export alone.
 */
export default {
  id: "context7",
  server: Context7Plugin,
} satisfies PluginModule;
