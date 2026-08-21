import { mkdir, writeFile, readFile, rm, symlink, lstat } from "fs/promises";
import { resolve, dirname } from "path";

import type { SkillFile } from "../types.js";
import { assertSkillNameInRoot } from "./skill-name.js";

function safeResolve(skillDir: string, filePath: string): string {
  const resolved = resolve(skillDir, filePath);
  if (
    !resolved.startsWith(skillDir + "/") &&
    !resolved.startsWith(skillDir + "\\") &&
    resolved !== skillDir
  ) {
    throw new Error(`Skill file path "${filePath}" resolves outside the target directory`);
  }
  return resolved;
}

export async function installSkillFiles(
  skillName: string,
  files: SkillFile[],
  skillsRoot: string,
  staleFiles: string[] = []
): Promise<void> {
  const skillDir = assertSkillNameInRoot(skillsRoot, skillName);

  for (const file of files) {
    const filePath = safeResolve(skillDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }

  const kept = files.map((file) => file.path);
  for (const stale of staleFiles) {
    if (!kept.includes(stale)) {
      await rm(safeResolve(skillDir, stale), { force: true });
    }
  }
}

export async function readSkillFiles(
  skillDir: string,
  paths: string[]
): Promise<SkillFile[] | null> {
  const files: SkillFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, content: await readFile(safeResolve(skillDir, path), "utf-8") });
    } catch {
      return null;
    }
  }
  return files;
}

export async function symlinkSkill(
  skillName: string,
  sourcePath: string,
  skillsRoot: string
): Promise<void> {
  const targetPath = assertSkillNameInRoot(skillsRoot, skillName);

  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      await rm(targetPath, { recursive: true });
    }
  } catch {}

  await mkdir(skillsRoot, { recursive: true });
  await symlink(sourcePath, targetPath);
}
