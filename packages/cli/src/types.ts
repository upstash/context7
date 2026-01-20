export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillRecord {
  id: string;
  repoId: string;
  name: string;
  description: string;
  path: string;
  branch: string;
  folderUrl: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  indexedAt?: number;
  installCount?: number;
}

export interface RepoSkillsResponse {
  repoId: string;
  skills: SkillRecord[];
  indexedAt: number;
  totalSkills: number;
  source: "cache" | "indexed";
  error?: string;
}

export interface SkillResponse extends SkillRecord {
  content?: string;
  source: "cache" | "indexed";
  error?: string;
}

export interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  repoId: string;
  path: string;
  folderUrl: string;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  score?: number;
  installCount?: number;
}

export interface SearchResponse {
  query: string;
  results: Array<{
    repoId: string;
    skills: SkillSearchResult[];
  }>;
  totalSkills: number;
  error?: string;
}

export interface IndexResponse {
  skill: SkillRecord;
  source: "indexed";
  error?: string;
}

export interface DownloadResponse {
  skill: SkillRecord;
  files: SkillFile[];
  error?: string;
}

export type IDE = "claude" | "cursor" | "codex" | "opencode" | "amp" | "antigravity";

export const IDE_PATHS: Record<IDE, string> = {
  claude: ".claude/skills",
  cursor: ".cursor/skills",
  codex: ".codex/skills",
  opencode: ".opencode/skill",
  amp: ".agents/skills",
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
