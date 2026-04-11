import { mkdir, writeFile, rm, symlink, lstat } from "fs/promises";
import { join, resolve, dirname } from "path";

import type { SkillFile } from "../types.js";

export async function installSkillFiles(
  skillName: string,
  files: SkillFile[],
  targetDir: string
): Promise<void> {
  const skillDir = resolve(targetDir, skillName);

  for (const file of files) {
    const filePath = resolve(skillDir, file.path);

    // Prevent directory traversal — resolved path must stay within skillDir
    if (!filePath.startsWith(skillDir + "/") && !filePath.startsWith(skillDir + "\\") && filePath !== skillDir) {
      throw new Error(`Skill file path "${file.path}" resolves outside the target directory`);
    }

    const fileDir = dirname(filePath);

    await mkdir(fileDir, { recursive: true });
    await writeFile(filePath, file.content);
  }
}

export async function symlinkSkill(
  skillName: string,
  sourcePath: string,
  targetDir: string
): Promise<void> {
  const targetPath = join(targetDir, skillName);

  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink() || stats.isDirectory()) {
      await rm(targetPath, { recursive: true });
    }
  } catch {}

  await mkdir(targetDir, { recursive: true });
  await symlink(sourcePath, targetPath);
}
