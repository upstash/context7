import { fileURLToPath } from "node:url";
import type { Config, PluginModule } from "@opencode-ai/plugin";

const MCP_BASE_URL = "https://mcp.context7.com";
const MCP_URL = `${MCP_BASE_URL}/mcp`;
const MCP_OAUTH_URL = `${MCP_BASE_URL}/mcp/oauth`;
const MCP_SERVER_NAME = "context7";

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

export interface Context7PluginOptions {
  apiKey?: string;
}

/** OpenCode's `Config` type does not declare `skills` yet, but the config schema accepts it. */
type ConfigWithSkills = Config & {
  skills?: { paths?: string[]; urls?: string[] };
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

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

/** Only the default export. Any other export is loaded as a second plugin by the legacy loader. */
export default {
  id: "context7",
  server: async (_input, options) => {
    const apiKey = nonEmptyString(options?.apiKey) ?? nonEmptyString(process.env.CONTEXT7_API_KEY);

    return {
      config: async (config) => {
        applyContext7Config(config, apiKey);
      },
    };
  },
} satisfies PluginModule;
