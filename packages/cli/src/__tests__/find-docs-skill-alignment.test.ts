import { describe, test, expect } from "vitest";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const skillPath = join(repoRoot, "skills/find-docs/SKILL.md");
const rulePath = join(repoRoot, "rules/context7-cli.md");

describe("find-docs skill aligns with context7-cli rule", () => {
  test("uses npx ctx7@latest as the canonical invocation style", async () => {
    const skill = await readFile(skillPath, "utf-8");
    expect(skill).toContain("npx ctx7@latest library");
    expect(skill).toContain("npx ctx7@latest docs");
    expect(skill).not.toMatch(/^ctx7 library/m);
    expect(skill).not.toContain("ctx7 library nextjs");
  });

  test("documents official library naming guidance", async () => {
    const skill = await readFile(skillPath, "utf-8");
    const rule = await readFile(rulePath, "utf-8");

    expect(skill).toContain('"Next.js" not "nextjs"');
    expect(rule).toContain('"Next.js" not "nextjs"');
    expect(skill).toContain('library "Next.js"');
  });

  test("does not recommend global install as the primary workflow", async () => {
    const skill = await readFile(skillPath, "utf-8");
    const npxIndex = skill.indexOf("npx ctx7@latest");
    const globalInstallIndex = skill.indexOf("npm install -g ctx7@latest");
    expect(npxIndex).toBeGreaterThanOrEqual(0);
    expect(globalInstallIndex).toBeGreaterThan(npxIndex);
  });
});
