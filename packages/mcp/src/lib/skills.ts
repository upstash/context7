import { SkillCatalog, memorySkillFiles } from "@modelcontextprotocol/server/ext/skills";
import { CONTEXT7_MCP_SKILL } from "./skill-md.js";

// Skill files change only on deploy, like the other static lists (STATIC_CACHE_HINT in index.ts).
const SKILL_CACHE_HINT = { ttlMs: 3_600_000, cacheScope: "public" } as const;

// Served through the MCP skills extension (SEP-2640) as skill://context7-mcp/SKILL.md.
// Loaded once at startup; index.ts attaches it to each per-request server.
export const context7SkillCatalog = await SkillCatalog.load(
  memorySkillFiles({ "context7-mcp/SKILL.md": CONTEXT7_MCP_SKILL }),
  { cacheHint: SKILL_CACHE_HINT, strict: true }
);
