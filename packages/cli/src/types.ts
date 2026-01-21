export interface SkillFile {
  path: string;
  content: string;
}

export interface Skill {
  name: string;
  description: string;
  url: string;
}

export interface SkillSearchResult extends Skill {
  project: string;
}

export interface ListSkillsResponse {
  project: string;
  skills: Skill[];
  error?: string;
  message?: string;
}

export interface SingleSkillResponse extends Skill {
  project: string;
  error?: string;
  message?: string;
}

export interface SearchResponse {
  results: SkillSearchResult[];
  error?: string;
  message?: string;
}

export interface DownloadResponse {
  skill: Skill & { project: string };
  files: SkillFile[];
  error?: string;
}

export type IDE = "claude" | "cursor" | "codex" | "opencode" | "amp" | "antigravity";

export type Scope = "project" | "global";

export interface IDEOptions {
  claude?: boolean;
  cursor?: boolean;
  codex?: boolean;
  opencode?: boolean;
  amp?: boolean;
  antigravity?: boolean;
}

export interface ScopeOptions {
  global?: boolean;
}

export type AddOptions = IDEOptions & ScopeOptions & { all?: boolean };
export type ListOptions = IDEOptions & ScopeOptions;
export type RemoveOptions = IDEOptions & ScopeOptions;

export interface InstallTargets {
  ides: IDE[];
  scopes: Scope[];
}

export const IDE_PATHS: Record<IDE, string> = {
  claude: ".claude/skills",
  cursor: ".cursor/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skills",
  amp: ".agents/skills",
  antigravity: ".agent/skills",
};

export const IDE_GLOBAL_PATHS: Record<IDE, string> = {
  claude: ".claude/skills",
  cursor: ".cursor/skills",
  codex: ".codex/skills",
  opencode: ".config/opencode/skills",
  amp: ".config/agents/skills",
  antigravity: ".agent/skills",
};

export const IDE_NAMES: Record<IDE, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
  amp: "Amp",
  antigravity: "Antigravity",
};

export interface C7Config {
  defaultIde: IDE;
  defaultScope: "project" | "global";
}

export const DEFAULT_CONFIG: C7Config = {
  defaultIde: "claude",
  defaultScope: "project",
};
