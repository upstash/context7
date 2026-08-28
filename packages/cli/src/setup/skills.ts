import { join } from "path";

import { downloadSkill } from "../utils/api.js";
import { readCliState, recordInstall } from "../utils/cli-state.js";
import { hashFiles, resolveSkill } from "../utils/content.js";
import { installSkillFiles } from "../utils/installer.js";
import type { SkillFile } from "../types.js";
import { getAgent, type SetupAgent } from "./agents.js";
import { customizeSkillFilesForAgent } from "./templates.js";

type Scope = "global" | "project";

export interface SkillContent {
  files: SkillFile[];
  revision: number;
}

const cache = new Map<string, Promise<SkillContent>>();

async function fetchSkillContent(skillName: string): Promise<SkillContent> {
  const resolved = await resolveSkill(skillName);
  if (resolved) return resolved;

  const download = await downloadSkill("/upstash/context7", skillName);
  if (download.error || download.files.length === 0) {
    throw new Error(download.error || "no files");
  }
  return { files: download.files, revision: 0 };
}

export function loadSkillContent(skillName: string): Promise<SkillContent> {
  let pending = cache.get(skillName);
  if (!pending) {
    pending = fetchSkillContent(skillName);
    cache.set(skillName, pending);
  }
  return pending;
}

export function resetSkillContentCache(): void {
  cache.clear();
}

export function getSkillsRoot(agentName: SetupAgent, scope: Scope): string {
  const agent = getAgent(agentName);
  return scope === "global"
    ? agent.skill.dir("global")
    : join(process.cwd(), agent.skill.dir("project"));
}

export function getSkillDir(agentName: SetupAgent, scope: Scope, skillName: string): string {
  return join(getSkillsRoot(agentName, scope), skillName);
}

export async function installSkill(
  agentName: SetupAgent,
  scope: Scope,
  skillName: string,
  root: string = getSkillsRoot(agentName, scope)
): Promise<string> {
  return writeSkill(agentName, scope, skillName, root, await loadSkillContent(skillName));
}

export async function writeSkill(
  agentName: SetupAgent,
  scope: Scope,
  skillName: string,
  root: string,
  { files, revision }: SkillContent
): Promise<string> {
  const customized = customizeSkillFilesForAgent(agentName, skillName, files);

  const dir = join(root, skillName);
  const previous = (await readCliState()).installs?.[dir];

  await installSkillFiles(
    skillName,
    customized,
    root,
    previous?.kind === "skill" ? previous.files : []
  );

  await recordInstall(dir, {
    kind: "skill",
    name: skillName,
    agent: agentName,
    scope,
    revision,
    hash: hashFiles(customized),
    files: customized.map((file) => file.path).sort(),
  });

  return dir;
}
