import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { afterEach, describe, expect, test } from "vitest";
import {
  CONTEXT7_CREDENTIAL_REF,
  DEEPSEEK_PLUGIN_PACKAGE,
  deepSeekPluginInvocation,
  resolveDshHome,
  validateDeepSeekProfile,
  writeDeepSeekCredential,
} from "../setup/deepseek.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ctx7-deepseek-setup-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("DeepSeek Harness setup", () => {
  test("resolves the Harness home", () => {
    const workspace = resolve("workspace");
    const userHome = join(workspace, "users", "test");
    expect(
      resolveDshHome({ DSH_HOME: join(workspace, "custom", "..", "dsh") }, userHome, workspace)
    ).toBe(join(workspace, "dsh"));
    expect(resolveDshHome({}, userHome, workspace)).toBe(join(userHome, ".dsh"));
    expect(resolveDshHome({ DSH_HOME: "   " }, userHome, workspace)).toBe(join(userHome, ".dsh"));
    expect(resolveDshHome({ DSH_HOME: "~/.harness" }, userHome, workspace)).toBe(
      join(userHome, ".harness")
    );
    expect(resolveDshHome({ DSH_HOME: join("state", "dsh") }, userHome, workspace)).toBe(
      join(workspace, "state", "dsh")
    );
  });

  test("writes the credential without replacing other entries or comments", async () => {
    const home = join(await temporaryRoot(), ".dsh");
    const filename = join(home, ".credentials.yaml");
    await mkdir(home, { recursive: true, mode: 0o755 });
    await writeFile(
      filename,
      "# existing credential\nDEEPSEEK_API_KEY: sk-deepseek\nCONTEXT7_API_KEY: old\n",
      { mode: 0o644 }
    );

    await expect(writeDeepSeekCredential("ctx7sk-new", home)).resolves.toBe(filename);

    const content = await readFile(filename, "utf8");
    const values = parseDocument(content).toJS() as Record<string, string>;
    expect(content).toContain("# existing credential");
    expect(values).toEqual({
      DEEPSEEK_API_KEY: "sk-deepseek",
      CONTEXT7_API_KEY: "ctx7sk-new",
    });
    if (process.platform !== "win32") {
      expect((await stat(home)).mode & 0o777).toBe(0o700);
      expect((await stat(filename)).mode & 0o777).toBe(0o600);
    }
  });

  test("refuses to overwrite an invalid credential document", async () => {
    const home = join(await temporaryRoot(), ".dsh");
    const filename = join(home, ".credentials.yaml");
    await mkdir(home, { recursive: true });
    await writeFile(filename, "DEEPSEEK_API_KEY: 42\n", "utf8");

    await expect(writeDeepSeekCredential("ctx7sk-new", home)).rejects.toThrow(
      'Credential "DEEPSEEK_API_KEY"'
    );
    await expect(readFile(filename, "utf8")).resolves.toBe("DEEPSEEK_API_KEY: 42\n");
  });

  test("folds in a credential update made by another locked writer", async () => {
    const home = join(await temporaryRoot(), ".dsh");
    const filename = join(home, ".credentials.yaml");
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(filename, "DEEPSEEK_API_KEY: first\n", { mode: 0o600 });
    await writeFile(`${filename}.lock`, "other-writer\n", { mode: 0o600, flag: "wx" });

    const pending = writeDeepSeekCredential("ctx7sk-new", home);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await writeFile(filename, "DEEPSEEK_API_KEY: second\nOTHER_API_KEY: preserved\n", {
      mode: 0o600,
    });
    await unlink(`${filename}.lock`);
    await pending;

    expect(parseDocument(await readFile(filename, "utf8")).toJS()).toEqual({
      DEEPSEEK_API_KEY: "second",
      OTHER_API_KEY: "preserved",
      CONTEXT7_API_KEY: "ctx7sk-new",
    });
  });

  test("builds the profile plugin installation command", () => {
    expect(deepSeekPluginInvocation("headless")).toEqual({
      command: "npx",
      args: [
        "--yes",
        "@deepseek-ai/dsh",
        "plugin",
        "--profile",
        "headless",
        "add",
        DEEPSEEK_PLUGIN_PACKAGE,
      ],
    });
    expect(() => deepSeekPluginInvocation("../profile")).toThrow(
      "Invalid DeepSeek Harness profile"
    );
    for (const profile of [
      "",
      ".",
      "..",
      "node_modules",
      "nested/profile",
      "nested\\profile",
      "team profile",
      "team&calc",
      "team|calc",
      "team<calc",
      "team>calc",
      "team^calc",
      "team(calc)",
      "team%PATH%",
      "team!calc",
      "team\ncalc",
    ]) {
      expect(() => validateDeepSeekProfile(profile)).toThrow("Invalid DeepSeek Harness profile");
    }
    expect(validateDeepSeekProfile("team-profile_1.0")).toBe("team-profile_1.0");
  });

  test("rejects an empty credential", async () => {
    await expect(writeDeepSeekCredential("", await temporaryRoot())).rejects.toThrow(
      "Context7 API key cannot be empty"
    );
    expect(CONTEXT7_CREDENTIAL_REF).toBe("CONTEXT7_API_KEY");
  });
});
