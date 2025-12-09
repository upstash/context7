// Agents
export { Context7Agent, type Context7AgentConfig } from "@agents";

// Tools
export { resolveLibrary, getLibraryDocs, type Context7ToolsConfig } from "@tools";

// Prompts
export {
  SYSTEM_PROMPT,
  AGENT_PROMPT,
  RESOLVE_LIBRARY_DESCRIPTION,
  GET_LIBRARY_DOCS_DESCRIPTION,
} from "@prompts";

// Re-export useful types from SDK
export type {
  SearchResult,
  SearchLibraryResponse,
  CodeDocsResponse,
  TextDocsResponse,
  InfoDocsResponse,
  Pagination,
} from "@upstash/context7-sdk";
