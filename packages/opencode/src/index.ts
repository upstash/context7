import { fileURLToPath } from "node:url";
import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { applyContext7Config, resolveOptions } from "./config.js";

/**
 * Absolute path to the skill folders shipped with this package.
 *
 * The build emits `dist/index.js`, so the bundled `skills` directory sits one level up.
 * OpenCode resolves relative skill paths against the project directory, and this package
 * lives outside the project, so the path has to be absolute and resolved at runtime.
 */
const skillsDir = fileURLToPath(new URL("../skills", import.meta.url));

/**
 * Context7 plugin for OpenCode.
 *
 * Registers the hosted Context7 MCP server, the `context7-mcp` skill, the
 * `docs-researcher` subagent, and the `/context7-docs` command.
 */
const Context7Plugin: Plugin = async (_input, options) => {
  const resolved = resolveOptions(options);

  return {
    config: async (config) => {
      applyContext7Config(config, { ...resolved, skillsDir });
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

export type { Context7PluginOptions } from "./config.js";
