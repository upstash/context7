import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Config, PluginModule } from "@opencode-ai/plugin";
import type { Mcp, Plugin, Skill } from "@opencode/plugin";

const MCP_BASE_URL = "https://mcp.context7.com";
const MCP_URL = `${MCP_BASE_URL}/mcp`;
const MCP_OAUTH_URL = `${MCP_BASE_URL}/mcp/oauth`;
const MCP_SERVER_NAME = "context7";

const SKILL_NAME = "context7-mcp";
const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const SKILL_FILE = fileURLToPath(new URL(`../skills/${SKILL_NAME}/SKILL.md`, import.meta.url));

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

function resolveApiKey(options: Record<string, unknown> | undefined): string | undefined {
  return nonEmptyString(options?.apiKey) ?? nonEmptyString(process.env.CONTEXT7_API_KEY);
}

function mcpServerConfig(apiKey: string | undefined) {
  return apiKey
    ? {
        type: "remote" as const,
        url: MCP_URL,
        headers: { Authorization: `Bearer ${apiKey}` },
        oauth: false as const,
      }
    : { type: "remote" as const, url: MCP_OAUTH_URL };
}

function applyContext7Config(config: Config, apiKey: string | undefined): void {
  config.mcp ??= {};
  config.mcp[MCP_SERVER_NAME] ??= { ...mcpServerConfig(apiKey), enabled: true };

  const withSkills = config as ConfigWithSkills;
  withSkills.skills ??= {};
  const skillPaths = (withSkills.skills.paths ??= []);
  if (!skillPaths.includes(SKILLS_DIR)) {
    skillPaths.push(SKILLS_DIR);
  }
}

/** Splits a SKILL.md file into its frontmatter description and body. */
function readSkill(): Skill.Info {
  const raw = readFileSync(SKILL_FILE, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const description = match?.[1].match(/^description:\s*(.+)$/m)?.[1].trim();
  return {
    id: SKILL_NAME,
    name: SKILL_NAME,
    description,
    path: SKILL_FILE,
    content: (match?.[2] ?? raw).trim(),
  } as Skill.Info;
}

/** OpenCode v2 entrypoint. Both transforms leave existing user configuration alone. */
const v2Plugin: Plugin.Plugin = {
  id: "context7",
  setup: async (ctx) => {
    const apiKey = resolveApiKey(ctx.options);

    await ctx.mcp.transform((editor) => {
      if (!editor.get(MCP_SERVER_NAME)) {
        editor.set(MCP_SERVER_NAME, mcpServerConfig(apiKey) as Mcp.ServerConfig);
      }
    });

    await ctx.skill.transform((editor) => {
      if (!editor.get(SKILL_NAME)) {
        editor.add(readSkill());
      }
    });
  },
};

/**
 * Only the default export. Any other export is loaded as a second plugin by the legacy loader.
 * OpenCode v2 calls `setup`; OpenCode v1 (1.18.29+) calls `server`.
 */
export default {
  ...v2Plugin,
  server: async (_input, options) => {
    const apiKey = resolveApiKey(options);

    return {
      config: async (config) => {
        applyContext7Config(config, apiKey);
      },
    };
  },
} satisfies PluginModule & Plugin.Plugin;
