import { mkdir, writeFile, rm, symlink, lstat } from "fs/promises";
import { join } from "path";

import type { SkillFile } from "../types.js";

export async function installSkillFiles(
  skillName: string,
  files: SkillFile[],
  targetDir: string
): Promise<void> {
  const skillDir = join(targetDir, skillName);

  for (const file of files) {
    const filePath = join(skillDir, file.path);
    const fileDir = join(filePath, "..");

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
