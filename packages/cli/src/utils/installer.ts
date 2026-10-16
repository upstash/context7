import { mkdir, writeFile } from "fs/promises";
import { resolve, dirname } from "path";

import type { SkillFile } from "../types.js";
import { assertSkillNameInRoot } from "./skill-name.js";

export async function installSkillFiles(
  skillName: string,
  files: SkillFile[],
  skillsRoot: string
): Promise<void> {
  const skillDir = assertSkillNameInRoot(skillsRoot, skillName);

  for (const file of files) {
    const filePath = resolve(skillDir, file.path);

    // Prevent directory traversal — resolved path must stay within skillDir
    if (
      !filePath.startsWith(skillDir + "/") &&
      !filePath.startsWith(skillDir + "\\") &&
      filePath !== skillDir
    ) {
      throw new Error(`Skill file path "${file.path}" resolves outside the target directory`);
    }

    const fileDir = dirname(filePath);

    await mkdir(fileDir, { recursive: true });
    await writeFile(filePath, file.content);
  }
}
