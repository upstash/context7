import { describe, expect, test } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { getTargetDirs } from "../utils/ide.js";

describe("getTargetDirs", () => {
  test("project directories default to the current working directory", () => {
    const dirs = getTargetDirs({ ides: ["claude", "universal"], scopes: ["project"] });

    expect(dirs).toEqual([
      join(process.cwd(), ".agents/skills"),
      join(process.cwd(), ".claude/skills"),
    ]);
  });

  test("an explicit project directory replaces the cwd, also when cwd is under $HOME", () => {
    const out = join(homedir(), "some", "other", "place");

    const dirs = getTargetDirs({ ides: ["claude", "universal"], scopes: ["project"] }, out);

    expect(dirs).toEqual([join(out, ".agents/skills"), join(out, ".claude/skills")]);
  });

  test("global directories stay under the home directory regardless of the project directory", () => {
    const dirs = getTargetDirs({ ides: ["cursor"], scopes: ["global", "project"] }, "/srv/app");

    expect(dirs).toEqual([join(homedir(), ".cursor/skills"), join("/srv/app", ".cursor/skills")]);
  });
});
