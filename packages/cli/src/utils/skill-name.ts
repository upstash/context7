import { resolve, dirname, basename } from "path";

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isSafeSkillName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 128) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("\0")) return false;
  if (!SAFE_NAME.test(name)) return false;
  return true;
}

export function assertSkillNameInRoot(skillsRoot: string, skillName: string): string {
  if (!isSafeSkillName(skillName)) {
    throw new Error(`Unsafe skill name: ${JSON.stringify(skillName)}`);
  }
  const root = resolve(skillsRoot);
  const target = resolve(root, skillName);
  if (dirname(target) !== root || basename(target) !== skillName) {
    throw new Error(`Skill name "${skillName}" escapes the skills root`);
  }
  return target;
}
