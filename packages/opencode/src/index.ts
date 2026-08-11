import { fileURLToPath } from "node:url";
import type { Config, Plugin, PluginModule } from "@opencode-ai/plugin";

const MCP_PACKAGE = "@upstash/context7-mcp";

const MCP_SERVER_NAME = "context7";
const AGENT_NAME = "docs-researcher";

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

const DOCS_RESEARCHER_PROMPT = `You are a documentation researcher specializing in fetching up-to-date library and framework documentation from Context7.

## Your Task

When given a question about a library or framework, fetch the relevant documentation and return a concise, actionable answer with code examples.

## Process

1. **Identify the library**: Extract the library/framework name from the user's question.

2. **Resolve the library ID**: Call \`context7_resolve-library-id\` with:
   - \`libraryName\`: The library name (e.g., "react", "next.js", "prisma")
   - \`query\`: What to look up in the library's documentation for relevance ranking

3. **Select the best match**: From the results, pick the library with:
   - Exact or closest name match
   - Highest benchmark score
   - Appropriate version if the user specified one (e.g., "React 19" → look for v19.x)

4. **Fetch documentation**: Call \`context7_query-docs\` with:
   - \`libraryId\`: The selected Context7 library ID (e.g., \`/vercel/next.js\`)
   - \`query\`: What to look up in the library's documentation for targeted results, scoped to a single concept

5. **Return a focused answer**: Summarize the relevant documentation with:
   - Direct answer to the question
   - Code examples from the docs
   - Links or references if available

## Guidelines

- Describe what to look up in the library's documentation in the query parameter, but keep each query to a single concept
- If the question spans multiple distinct concepts (e.g. routing and auth and caching), make a separate \`context7_query-docs\` call per concept with the same library ID, unless the question is about how the concepts interact — combined queries dilute ranking and return shallow results for each topic
- When the user mentions a version (e.g., "Next.js 15"), use version-specific library IDs if available
- If \`context7_resolve-library-id\` returns multiple matches, prefer official/primary packages over community forks
- Keep responses concise - the goal is to answer the question, not dump entire documentation`;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Adds the Context7 MCP server, skill, and subagent to the resolved config.
 *
 * Every entry is additive. An existing entry under the same key always wins, so a user
 * who configures Context7 by hand keeps their own settings.
 */
function applyContext7Config(config: Config, apiKey: string | undefined): void {
  // The hosted server is reachable over Streamable HTTP, but OpenCode's remote client
  // also opens the optional GET SSE stream, which mcp.context7.com answers with a 405.
  // OpenCode treats that as a connection failure and registers no tools, so the model
  // never sees resolve-library-id. Running the server over stdio avoids the issue.
  config.mcp ??= {};
  config.mcp[MCP_SERVER_NAME] ??= {
    type: "local",
    command: ["npx", "-y", MCP_PACKAGE, ...(apiKey ? ["--api-key", apiKey] : [])],
    enabled: true,
  };

  const withSkills = config as ConfigWithSkills;
  withSkills.skills ??= {};
  const skillPaths = (withSkills.skills.paths ??= []);
  if (!skillPaths.includes(SKILLS_DIR)) {
    skillPaths.push(SKILLS_DIR);
  }

  config.agent ??= {};
  config.agent[AGENT_NAME] ??= {
    description:
      "Fetches up-to-date library documentation from Context7 without cluttering the main conversation context.",
    mode: "subagent",
    prompt: DOCS_RESEARCHER_PROMPT,
    // The agent only reads documentation, so it never edits files. This has to be a
    // permission rather than a `tools` entry: OpenCode drops the `tools` map of an
    // agent that a plugin registers, but it does honour `permission`.
    permission: { edit: "deny" },
  };
}

/**
 * Context7 plugin for OpenCode.
 *
 * Registers the hosted Context7 MCP server, the `context7-mcp` skill, and the
 * `docs-researcher` subagent.
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
