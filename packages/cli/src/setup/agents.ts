import { access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export type SetupAgent = "claude" | "cursor" | "opencode";
export type AuthMode = "oauth" | "api-key";

export interface AuthOptions {
  mode: AuthMode;
  apiKey?: string;
}

export const SETUP_AGENT_NAMES: Record<SetupAgent, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  opencode: "OpenCode",
};

export const AUTH_MODE_LABELS: Record<AuthMode, string> = {
  oauth: "OAuth",
  "api-key": "API Key",
};

const MCP_BASE_URL = "https://mcp.context7.com";

export interface AgentConfig {
  name: SetupAgent;
  displayName: string;
  mcp: {
    projectPath: string;
    globalPath: string;
    configKey: string;
    buildEntry: (auth: AuthOptions) => Record<string, unknown>;
  };
  rule: {
    dir: (scope: "project" | "global") => string;
    filename: string;
    /** When set, the rule path is registered in the agent's config `instructions` array */
    instructionsGlob?: (scope: "project" | "global") => string;
  };
  detect: {
    projectPaths: string[];
    globalPaths: string[];
  };
}

function mcpUrl(auth: AuthOptions): string {
  return auth.mode === "oauth" ? `${MCP_BASE_URL}/mcp/oauth` : `${MCP_BASE_URL}/mcp`;
}

function withHeaders(base: Record<string, unknown>, auth: AuthOptions): Record<string, unknown> {
  if (auth.mode === "api-key" && auth.apiKey) {
    return { ...base, headers: { CONTEXT7_API_KEY: auth.apiKey } };
  }
  return base;
}

const agents: Record<SetupAgent, AgentConfig> = {
  claude: {
    name: "claude",
    displayName: "Claude Code",
    mcp: {
      projectPath: ".mcp.json",
      globalPath: join(homedir(), ".claude.json"),
      configKey: "mcpServers",
      buildEntry: (auth) => withHeaders({ type: "http", url: mcpUrl(auth) }, auth),
    },
    rule: {
      dir: (scope) =>
        scope === "global" ? join(homedir(), ".claude", "rules") : join(".claude", "rules"),
      filename: "context7.md",
    },
    detect: {
      projectPaths: [".mcp.json", ".claude"],
      globalPaths: [join(homedir(), ".claude")],
    },
  },

  cursor: {
    name: "cursor",
    displayName: "Cursor",
    mcp: {
      projectPath: join(".cursor", "mcp.json"),
      globalPath: join(homedir(), ".cursor", "mcp.json"),
      configKey: "mcpServers",
      buildEntry: (auth) => withHeaders({ url: mcpUrl(auth) }, auth),
    },
    rule: {
      dir: (scope) =>
        scope === "global" ? join(homedir(), ".cursor", "rules") : join(".cursor", "rules"),
      filename: "context7.mdc",
    },
    detect: {
      projectPaths: [".cursor"],
      globalPaths: [join(homedir(), ".cursor")],
    },
  },

  opencode: {
    name: "opencode",
    displayName: "OpenCode",
    mcp: {
      projectPath: ".opencode.json",
      globalPath: join(homedir(), ".config", "opencode", "opencode.json"),
      configKey: "mcp",
      buildEntry: (auth) => withHeaders({ type: "remote", url: mcpUrl(auth), enabled: true }, auth),
    },
    rule: {
      dir: (scope) =>
        scope === "global"
          ? join(homedir(), ".config", "opencode", "rules")
          : join(".opencode", "rules"),
      filename: "context7.md",
      instructionsGlob: (scope) =>
        scope === "global"
          ? join(homedir(), ".config", "opencode", "rules", "*.md")
          : ".opencode/rules/*.md",
    },
    detect: {
      projectPaths: [".opencode.json"],
      globalPaths: [join(homedir(), ".config", "opencode")],
    },
  },
};

export function getAgent(name: SetupAgent): AgentConfig {
  return agents[name];
}

export const ALL_AGENT_NAMES: SetupAgent[] = Object.keys(agents) as SetupAgent[];

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectAgents(scope: "project" | "global"): Promise<SetupAgent[]> {
  const detected: SetupAgent[] = [];

  for (const agent of Object.values(agents)) {
    const paths = scope === "global" ? agent.detect.globalPaths : agent.detect.projectPaths;
    for (const p of paths) {
      const fullPath = scope === "global" ? p : join(process.cwd(), p);
      if (await pathExists(fullPath)) {
        detected.push(agent.name);
        break;
      }
    }
  }

  return detected;
}
