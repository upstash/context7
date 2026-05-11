import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdir, readFile, writeFile, rm, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { installSkillFiles, symlinkSkill } from "../utils/installer.js";
import { isSafeSkillName, assertSkillNameInRoot } from "../utils/skill-name.js";

let tempDir: string;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `ctx7-installer-test-${Date.now()}-${Math.random()}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("isSafeSkillName", () => {
  test("accepts typical skill names", () => {
    for (const name of [
      "pdf",
      "find-docs",
      "skill_one",
      "skill.v2",
      "a1",
      "abc123",
      "PDF",
      "Find-Docs",
      "MySkill",
    ]) {
      expect(isSafeSkillName(name)).toBe(true);
    }
  });

  test("rejects path traversal and separators", () => {
    for (const name of [
      "..",
      ".",
      "../evil",
      "..\\evil",
      "a/b",
      "a\\b",
      "/abs",
      "C:\\drive",
      "with space",
      "",
      ".hidden",
      "name\0",
      "name\nwith-newline",
    ]) {
      expect(isSafeSkillName(name)).toBe(false);
    }
  });

  test("rejects names longer than 128 chars", () => {
    expect(isSafeSkillName("a".repeat(128))).toBe(true);
    expect(isSafeSkillName("a".repeat(129))).toBe(false);
  });
});

describe("assertSkillNameInRoot", () => {
  test("returns resolved path for safe name", () => {
    const result = assertSkillNameInRoot("/tmp/skills", "pdf");
    expect(result).toBe("/tmp/skills/pdf");
  });

  test("throws on traversal", () => {
    expect(() => assertSkillNameInRoot("/tmp/skills", "..")).toThrow();
    expect(() => assertSkillNameInRoot("/tmp/skills", "../evil")).toThrow();
  });
});

describe("installSkillFiles", () => {
  test("writes files inside the skill directory", async () => {
    const skillsRoot = join(tempDir, "skills");
    await mkdir(skillsRoot, { recursive: true });

    await installSkillFiles("good", [{ path: "SKILL.md", content: "hello" }], skillsRoot);

    const written = await readFile(join(skillsRoot, "good", "SKILL.md"), "utf8");
    expect(written).toBe("hello");
  });

  test("rejects skill name '..' and does not write outside skills root", async () => {
    const skillsRoot = join(tempDir, ".claude", "skills");
    await mkdir(skillsRoot, { recursive: true });

    const settingsPath = join(tempDir, ".claude", "settings.json");

    await expect(
      installSkillFiles("..", [{ path: "settings.json", content: '{"hooks":{}}' }], skillsRoot)
    ).rejects.toThrow();

    expect(await exists(settingsPath)).toBe(false);
  });

  test("rejects skill names with path separators", async () => {
    const skillsRoot = join(tempDir, "skills");
    await mkdir(skillsRoot, { recursive: true });

    for (const bad of ["../evil", "a/b", "..\\evil"]) {
      await expect(
        installSkillFiles(bad, [{ path: "SKILL.md", content: "x" }], skillsRoot)
      ).rejects.toThrow();
    }
  });

  test("still rejects traversal in file.path", async () => {
    const skillsRoot = join(tempDir, "skills");
    await mkdir(skillsRoot, { recursive: true });

    await expect(
      installSkillFiles("good", [{ path: "../escape.txt", content: "x" }], skillsRoot)
    ).rejects.toThrow(/outside/);
  });
});

describe("symlinkSkill", () => {
  test("creates symlink under skills root for safe name", async () => {
    const skillsRoot = join(tempDir, "linked");
    await mkdir(skillsRoot, { recursive: true });

    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "marker"), "ok");

    await symlinkSkill("good", source, skillsRoot);

    const linkedMarker = await readFile(join(skillsRoot, "good", "marker"), "utf8");
    expect(linkedMarker).toBe("ok");
  });

  test("does not rm parent when skill name is '..'", async () => {
    const skillsRoot = join(tempDir, ".cursor", "skills");
    await mkdir(skillsRoot, { recursive: true });

    const sentinel = join(tempDir, ".cursor", "keep.txt");
    await writeFile(sentinel, "sentinel");

    const source = join(tempDir, "source");
    await mkdir(source, { recursive: true });

    await expect(symlinkSkill("..", source, skillsRoot)).rejects.toThrow();

    expect(await exists(sentinel)).toBe(true);
    expect(await exists(join(tempDir, ".cursor"))).toBe(true);
  });
});
