import type { Config, PluginOptions } from "@opencode-ai/plugin";

const MCP_BASE_URL = "https://mcp.context7.com";

/** Anonymous and API key requests both go to `/mcp`. */
export const MCP_URL = `${MCP_BASE_URL}/mcp`;

/** `/mcp/oauth` answers with a 401 and OAuth metadata, which triggers OpenCode's OAuth flow. */
export const MCP_OAUTH_URL = `${MCP_BASE_URL}/mcp/oauth`;

export const MCP_SERVER_NAME = "context7";
export const AGENT_NAME = "docs-researcher";
export const COMMAND_NAME = "context7-docs";

export interface Context7PluginOptions {
  /** Context7 API key. Falls back to the `CONTEXT7_API_KEY` environment variable. */
  apiKey?: string;
  /** Register the bundled `context7-mcp` skill. Defaults to `true`. */
  skill?: boolean;
  /** Register the `docs-researcher` subagent. Defaults to `true`. */
  agent?: boolean;
  /** Register the `/context7-docs` command. Defaults to `true`. */
  command?: boolean;
}

interface ApplyInput extends Context7PluginOptions {
  /** Absolute path to the directory that holds the bundled skill folders. */
  skillsDir: string;
}

/** OpenCode's `Config` type does not declare `skills` yet, but the config schema accepts it. */
type ConfigWithSkills = Config & {
  skills?: { paths?: string[]; urls?: string[] };
};

const DOCS_RESEARCHER_PROMPT = `You are a documentation researcher specializing in fetching up-to-date library and framework documentation from Context7.

## Your Task

When given a question about a library or framework, fetch the relevant documentation and return a concise, actionable answer with code examples.

## Process

1. **Identify the library**: Extract the library/framework name from the user's question.

2. **Resolve the library ID**: Call \`resolve-library-id\` with:
   - \`libraryName\`: The library name (e.g., "react", "next.js", "prisma")
   - \`query\`: What to look up in the library's documentation for relevance ranking

3. **Select the best match**: From the results, pick the library with:
   - Exact or closest name match
   - Highest benchmark score
   - Appropriate version if the user specified one (e.g., "React 19" → look for v19.x)

4. **Fetch documentation**: Call \`query-docs\` with:
   - \`libraryId\`: The selected Context7 library ID (e.g., \`/vercel/next.js\`)
   - \`query\`: What to look up in the library's documentation for targeted results, scoped to a single concept

5. **Return a focused answer**: Summarize the relevant documentation with:
   - Direct answer to the question
   - Code examples from the docs
   - Links or references if available

## Guidelines

- Describe what to look up in the library's documentation in the query parameter, but keep each query to a single concept
- If the question spans multiple distinct concepts (e.g. routing and auth and caching), make a separate \`query-docs\` call per concept with the same library ID, unless the question is about how the concepts interact — combined queries dilute ranking and return shallow results for each topic
- When the user mentions a version (e.g., "Next.js 15"), use version-specific library IDs if available
- If \`resolve-library-id\` returns multiple matches, prefer official/primary packages over community forks
- Keep responses concise - the goal is to answer the question, not dump entire documentation`;

const DOCS_COMMAND_TEMPLATE = `Look up documentation with Context7 for: $ARGUMENTS

The first token is the library, everything after it is the query.

1. If the library starts with \`/\`, use it directly as the Context7 library ID and skip resolution. It may include a version, for example \`/vercel/next.js/v15.1.8\`.
2. Otherwise call \`resolve-library-id\` with the library name and the query, then pick the closest name match with the highest benchmark score. Prefer a version-specific ID when the request names a version.
3. Call \`query-docs\` with the selected library ID and the query, scoped to a single concept. If the request covers multiple distinct concepts, make one call per concept, unless the question is about how the concepts interact.
4. Answer from the fetched documentation and include the relevant code examples.

If no query was given, fetch an overview of the library and its most common usage.`;

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Narrows the untyped options object OpenCode passes from the `plugin` config entry. */
export function resolveOptions(
  options: PluginOptions | undefined,
  env: NodeJS.ProcessEnv = process.env
): Context7PluginOptions {
  return {
    apiKey: readString(options?.apiKey) ?? readString(env.CONTEXT7_API_KEY),
    skill: readBoolean(options?.skill, true),
    agent: readBoolean(options?.agent, true),
    command: readBoolean(options?.command, true),
  };
}

/**
 * Adds the Context7 MCP server, skill, subagent, and command to the resolved config.
 *
 * Every entry is additive. An existing entry under the same key always wins, so a user
 * who configures Context7 by hand keeps their own settings.
 */
export function applyContext7Config(config: Config, input: ApplyInput): void {
  const { apiKey, skillsDir, skill = true, agent = true, command = true } = input;

  config.mcp ??= {};
  if (!config.mcp[MCP_SERVER_NAME]) {
    config.mcp[MCP_SERVER_NAME] = apiKey
      ? {
          type: "remote",
          url: MCP_URL,
          enabled: true,
          headers: { Authorization: `Bearer ${apiKey}` },
          oauth: false,
        }
      : { type: "remote", url: MCP_OAUTH_URL, enabled: true };
  }

  if (skill) {
    const skills = config as ConfigWithSkills;
    skills.skills ??= {};
    skills.skills.paths ??= [];
    if (!skills.skills.paths.includes(skillsDir)) {
      skills.skills.paths.push(skillsDir);
    }
  }

  if (agent) {
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

  if (command) {
    config.command ??= {};
    config.command[COMMAND_NAME] ??= {
      description: "Look up documentation for any library",
      template: DOCS_COMMAND_TEMPLATE,
    };
  }
}
