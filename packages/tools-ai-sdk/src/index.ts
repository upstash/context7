// Agents
export { Context7Agent, type Context7AgentConfig } from "@agents";

// Tools
export { resolveLibraryId, queryDocs, type Context7ToolsConfig } from "@tools";

// Prompts
export {
  SYSTEM_PROMPT,
  AGENT_PROMPT,
  RESOLVE_LIBRARY_ID_DESCRIPTION,
  QUERY_DOCS_DESCRIPTION,
} from "@prompts";

// Re-export useful types from SDK
export type {
  Context7Config,
  Library,
  Documentation,
  GetContextOptions,
} from "@upstash/context7-sdk";
