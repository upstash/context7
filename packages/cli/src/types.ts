export interface SkillFile {
  path: string;
  content: string;
}

export interface Skill {
  name: string;
  description: string;
  url: string;
  installCount?: number;
  trustScore?: number;
}

export interface SkillSearchResult extends Skill {
  project: string;
}

export interface ListSkillsResponse {
  project: string;
  skills: Skill[];
  blockedSkillsCount?: number;
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

// Library search types
export interface LibrarySearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  totalSnippets: number;
  totalTokens?: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
  vip?: boolean;
}

export interface LibrarySearchResponse {
  results: LibrarySearchResult[];
  error?: string;
  message?: string;
}

// Skill generation types
export interface SkillQuestion {
  question: string;
  options: string[];
  recommendedIndex: number;
}

export interface SkillQuestionsResponse {
  questions: SkillQuestion[];
  error?: string;
  message?: string;
}

export interface SkillAnswer {
  question: string;
  answer: string;
}

export interface LibraryInput {
  id: string;
  name: string;
}

export interface StructuredGenerateInput {
  motivation: string;
  libraries: LibraryInput[];
  answers: SkillAnswer[];
  feedback?: string;
  previousContent?: string;
}

export interface ToolResultSnippet {
  title: string;
  content: string;
}

export interface ProgressEvent {
  type: "progress";
  message: string;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolName: string;
  query: string;
  libraryId?: string;
  results: ToolResultSnippet[];
}

export interface CompleteEvent {
  type: "complete";
  content: string;
  libraryName: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type GenerateStreamEvent = ProgressEvent | ToolResultEvent | CompleteEvent | ErrorEvent;

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
export type SuggestOptions = IDEOptions & ScopeOptions;
export type ListOptions = IDEOptions & ScopeOptions;
export type RemoveOptions = IDEOptions & ScopeOptions;
export type GenerateOptions = IDEOptions &
  ScopeOptions & {
    output?: string;
    all?: boolean;
  };

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

// Suggest endpoint types
export interface SuggestSkill extends SkillSearchResult {
  matchedDep: string;
}

export interface SuggestResponse {
  skills: SuggestSkill[];
  error?: string;
  message?: string;
}

export interface SkillQuotaResponse {
  used: number;
  limit: number;
  remaining: number;
  tier: "free" | "pro" | "unlimited";
  resetDate: string | null;
  message?: string;
  error?: string;
}
