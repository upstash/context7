import { readFileSync } from "fs";
import { tool } from "ai";
import { z } from "zod";
import type { IntegrationDef } from "../types.js";

const SKILL_TOOL = tool({
  description: "Invoke an available skill by name.",
  inputSchema: z.object({
    skill: z.string().describe("The name of the skill to invoke"),
    args: z.string().optional().describe("Optional arguments to pass to the skill"),
  }),
  execute: async ({ skill, args }) =>
    `Skill "${skill}" invoked successfully.${args ? ` Args: ${args}` : ""}`,
});

/**
 * Parses the YAML frontmatter from a SKILL.md file and returns the name and
 * description fields. The description is the folded block scalar (>-) that
 * describes when the skill should be used.
 */
function parseFrontmatter(content: string): { name: string; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { name: "", description: content };
  const fm = fmMatch[1];

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const name = nameMatch?.[1]?.trim() ?? "";

  // Extract folded block scalar description (>- or >)
  const descLines: string[] = [];
  let inDesc = false;
  for (const line of fm.split("\n")) {
    if (/^description:\s*>/.test(line)) {
      inDesc = true;
      continue;
    }
    if (inDesc) {
      if (/^\w/.test(line)) break; // next top-level key
      descLines.push(line.replace(/^  /, ""));
    }
  }

  return { name, description: descLines.join("\n").trim() };
}

/**
 * Creates an IntegrationDef for a Claude Code skill.
 *
 * For the aisdk runner, the skill is advertised via an <available_skills> block
 * in the system prompt (matching how Claude Code presents skills natively).
 * Only the frontmatter description is used — no CLI workflow instructions.
 *
 * @param name - Integration display name (e.g. "find-docs")
 * @param skillPath - Absolute path to the SKILL.md file
 * @param skillName - Actual skill name used at invocation time (defaults to name)
 */
export function createSkillIntegration(
  name: string,
  skillPath: string,
  skillName?: string
): IntegrationDef {
  const actualSkillName = skillName ?? name;
  const content = readFileSync(skillPath, "utf-8");
  const { description } = parseFrontmatter(content);

  const systemPrompt = `You are a helpful AI assistant. You have access to skills that extend your capabilities.

<available_skills>
<skill>
<name>${actualSkillName}</name>
<description>${description}</description>
<location>${actualSkillName}</location>
</skill>
</available_skills>`;

  return {
    name,
    type: "skill",
    shortCode: "skill",
    systemPrompt,
    tools: { Skill: SKILL_TOOL },
    watchTools: ["Skill"],
    matchInvocation: (_toolName, args) => {
      const input = args as { skill?: string };
      return input.skill === actualSkillName;
    },
  };
}
