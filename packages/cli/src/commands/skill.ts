import { Command } from "commander";
import pc from "picocolors";
import { checkbox } from "@inquirer/prompts";
import ora from "ora";
import { readdir, rm } from "fs/promises";
import { join } from "path";

import { parseSkillInput } from "../utils/parse-input.js";
import {
  listProjectSkills,
  searchSkills,
  downloadSkill,
  getSkill,
  trackInstalls,
} from "../utils/api.js";
import { log } from "../utils/logger.js";
import {
  promptForInstallTargets,
  promptForSingleTarget,
  getTargetDirs,
  getTargetDirFromSelection,
} from "../utils/ide.js";
import { installSkillFiles, symlinkSkill } from "../utils/installer.js";
import type {
  Skill,
  SkillSearchResult,
  AddOptions,
  ListOptions,
  RemoveOptions,
  InstallTargets,
} from "../types.js";
import { IDE_NAMES } from "../types.js";

function logInstallSummary(
  targets: InstallTargets,
  targetDirs: string[],
  skillNames: string[]
): void {
  log.blank();
  let dirIndex = 0;
  for (const ide of targets.ides) {
    for (let i = 0; i < targets.scopes.length; i++) {
      const dir = targetDirs[dirIndex++];
      log.dim(`${IDE_NAMES[ide]}: ${dir}`);
      for (const name of skillNames) {
        log.itemAdd(name);
      }
    }
  }
  log.blank();
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skills").alias("skill").description("Manage AI coding skills");

  skill
    .command("install")
    .alias("i")
    .alias("add")
    .argument("<repository>", "GitHub repository (/owner/repo)")
    .argument("[skill]", "Specific skill name to install")
    .option("--all", "Install all skills without prompting")
    .option("--global", "Install globally instead of current directory")
    .option("--claude", "Claude Code (.claude/skills/)")
    .option("--cursor", "Cursor (.cursor/skills/)")
    .option("--codex", "Codex (.codex/skills/)")
    .option("--opencode", "OpenCode (.opencode/skills/)")
    .option("--amp", "Amp (.agents/skills/)")
    .option("--antigravity", "Antigravity (.agent/skills/)")
    .description("Install skills from a repository")
    .action(async (project: string, skillName: string | undefined, options: AddOptions) => {
      await installCommand(project, skillName, options);
    });

  skill
    .command("search")
    .alias("s")
    .argument("<keywords...>", "Search keywords")
    .description("Search for skills across all indexed repositories")
    .action(async (keywords: string[]) => {
      await searchCommand(keywords.join(" "));
    });

  skill
    .command("list")
    .alias("ls")
    .option("--global", "List global skills")
    .option("--claude", "Claude Code (.claude/skills/)")
    .option("--cursor", "Cursor (.cursor/skills/)")
    .option("--codex", "Codex (.codex/skills/)")
    .option("--opencode", "OpenCode (.opencode/skills/)")
    .option("--amp", "Amp (.agents/skills/)")
    .option("--antigravity", "Antigravity (.agent/skills/)")
    .description("List installed skills")
    .action(async (options: ListOptions) => {
      await listCommand(options);
    });

  skill
    .command("remove")
    .alias("rm")
    .alias("delete")
    .argument("<name>", "Skill name to remove")
    .option("--global", "Remove from global skills")
    .option("--claude", "Claude Code (.claude/skills/)")
    .option("--cursor", "Cursor (.cursor/skills/)")
    .option("--codex", "Codex (.codex/skills/)")
    .option("--opencode", "OpenCode (.opencode/skills/)")
    .option("--amp", "Amp (.agents/skills/)")
    .option("--antigravity", "Antigravity (.agent/skills/)")
    .description("Remove an installed skill")
    .action(async (name: string, options: RemoveOptions) => {
      await removeCommand(name, options);
    });

  skill
    .command("info")
    .argument("<repository>", "GitHub repository (/owner/repo)")
    .description("Show skills in a repository")
    .action(async (project: string) => {
      await infoCommand(project);
    });
}

export function registerSkillAliases(program: Command): void {
  program
    .command("si", { hidden: true })
    .argument("<repository>", "GitHub repository (/owner/repo)")
    .argument("[skill]", "Specific skill name to install")
    .option("--all", "Install all skills without prompting")
    .option("--global", "Install globally instead of current directory")
    .option("--claude", "Claude Code (.claude/skills/)")
    .option("--cursor", "Cursor (.cursor/skills/)")
    .option("--codex", "Codex (.codex/skills/)")
    .option("--opencode", "OpenCode (.opencode/skills/)")
    .option("--amp", "Amp (.agents/skills/)")
    .option("--antigravity", "Antigravity (.agent/skills/)")
    .description("Install skills (alias for: skills install)")
    .action(async (project: string, skillName: string | undefined, options: AddOptions) => {
      await installCommand(project, skillName, options);
    });

  program
    .command("ss", { hidden: true })
    .argument("<keywords...>", "Search keywords")
    .description("Search for skills (alias for: skills search)")
    .action(async (keywords: string[]) => {
      await searchCommand(keywords.join(" "));
    });
}

async function installCommand(
  input: string,
  skillName: string | undefined,
  options: AddOptions
): Promise<void> {
  const parsed = parseSkillInput(input);
  if (!parsed) {
    log.error(`Invalid input format: ${input}`);
    log.info(`Expected: /owner/repo or full GitHub URL`);
    log.info(`Example: ctx7 skills install /anthropics/skills pdf`);
    log.blank();
    return;
  }
  const repo = `/${parsed.owner}/${parsed.repo}`;

  log.blank();
  const spinner = ora(`Fetching skills from ${repo}...`).start();

  let selectedSkills: (Skill & { project: string })[];

  // When a specific skill name is provided, fetch only that skill
  if (skillName) {
    spinner.text = `Fetching skill: ${skillName}...`;
    const skillData = await getSkill(repo, skillName);

    if (skillData.error || !skillData.name) {
      spinner.fail(pc.red(`Skill not found: ${skillName}`));
      return;
    }

    spinner.succeed(`Found skill: ${skillName}`);
    selectedSkills = [
      {
        name: skillData.name,
        description: skillData.description,
        url: skillData.url,
        project: repo,
      },
    ];
  } else {
    // Fetch all skills when no specific names provided
    const data = await listProjectSkills(repo);

    if (data.error) {
      spinner.fail(pc.red(`Error: ${data.message || data.error}`));
      return;
    }

    if (!data.skills || data.skills.length === 0) {
      spinner.warn(pc.yellow(`No skills found in ${repo}`));
      return;
    }

    const skillsWithRepo = data.skills.map((s) => ({ ...s, project: repo }));

    if (options.all || data.skills.length === 1) {
      spinner.succeed(`Found ${data.skills.length} skill(s)`);
      selectedSkills = skillsWithRepo;
    } else {
      spinner.succeed(`Found ${data.skills.length} skill(s)`);
      const maxNameLen = Math.min(25, Math.max(...data.skills.map((s) => s.name.length)));
      const choices = skillsWithRepo.map((s) => {
        const paddedName = s.name.padEnd(maxNameLen);
        const desc = s.description?.trim()
          ? s.description.slice(0, 60) + (s.description.length > 60 ? "..." : "")
          : "";

        return {
          name: desc ? `${paddedName} ${pc.dim(desc)}` : s.name,
          value: s,
        };
      });

      log.blank();

      try {
        selectedSkills = await checkbox({
          message: "Select skills:",
          choices,
          pageSize: 15,
          theme: {
            style: {
              renderSelectedChoices: (selected: Array<{ name?: string; value: unknown }>) =>
                selected.map((c) => (c.value as { name: string }).name).join(", "),
            },
          },
        });
      } catch {
        log.warn("Installation cancelled");
        return;
      }
    }
  }

  if (selectedSkills.length === 0) {
    log.warn("No skills selected");
    return;
  }

  const targets = await promptForInstallTargets(options);
  if (!targets) {
    log.warn("Installation cancelled");
    return;
  }

  const targetDirs = getTargetDirs(targets);

  const installSpinner = ora("Installing skills...").start();

  let permissionError = false;
  const failedDirs: Set<string> = new Set();
  const installedSkills: string[] = [];

  for (const skill of selectedSkills) {
    try {
      installSpinner.text = `Downloading ${skill.name}...`;
      const downloadData = await downloadSkill(skill.project, skill.name);

      if (downloadData.error) {
        log.warn(`Failed to download ${skill.name}: ${downloadData.error}`);
        continue;
      }

      installSpinner.text = `Installing ${skill.name}...`;

      const [primaryDir, ...symlinkDirs] = targetDirs;

      try {
        await installSkillFiles(skill.name, downloadData.files, primaryDir);
      } catch (dirErr) {
        const error = dirErr as NodeJS.ErrnoException;
        if (error.code === "EACCES" || error.code === "EPERM") {
          permissionError = true;
          failedDirs.add(primaryDir);
        }
        throw dirErr;
      }

      const primarySkillDir = join(primaryDir, skill.name);
      for (const targetDir of symlinkDirs) {
        try {
          await symlinkSkill(skill.name, primarySkillDir, targetDir);
        } catch (dirErr) {
          const error = dirErr as NodeJS.ErrnoException;
          if (error.code === "EACCES" || error.code === "EPERM") {
            permissionError = true;
            failedDirs.add(targetDir);
          }
          throw dirErr;
        }
      }

      installedSkills.push(`${skill.project}/${skill.name}`);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EACCES" || error.code === "EPERM") {
        continue;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to install ${skill.name}: ${errMsg}`);
    }
  }

  if (permissionError) {
    installSpinner.fail("Permission denied");
    log.blank();
    log.warn("Fix permissions with:");
    for (const dir of failedDirs) {
      const parentDir = join(dir, "..");
      log.dim(`  sudo chown -R $(whoami) "${parentDir}"`);
    }
    log.blank();
    return;
  }

  installSpinner.succeed(`Installed ${installedSkills.length} skill(s)`);
  trackInstalls(installedSkills, targets.ides);

  const installedNames = selectedSkills.map((s) => s.name);
  logInstallSummary(targets, targetDirs, installedNames);
}

async function searchCommand(query: string): Promise<void> {
  log.blank();
  const spinner = ora(`Searching for "${query}"...`).start();

  let data;
  try {
    data = await searchSkills(query);
  } catch (err) {
    spinner.fail(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  if (data.error) {
    spinner.fail(pc.red(`Error: ${data.message || data.error}`));
    return;
  }

  if (!data.results || data.results.length === 0) {
    spinner.warn(pc.yellow(`No skills found matching "${query}"`));
    return;
  }

  spinner.succeed(`Found ${data.results.length} skill(s)`);

  const maxNameLen = Math.min(25, Math.max(...data.results.map((s) => s.name.length)));
  const choices = data.results.map((s) => {
    const paddedName = s.name.padEnd(maxNameLen);
    const repoName = pc.dim(`(${s.project})`);
    const desc = s.description?.trim()
      ? s.description.slice(0, 50) + (s.description.length > 50 ? "..." : "")
      : "";

    return {
      name: desc ? `${paddedName} ${repoName} ${pc.dim(desc)}` : `${paddedName} ${repoName}`,
      value: s,
    };
  });

  log.blank();

  let selectedSkills: SkillSearchResult[];
  try {
    selectedSkills = await checkbox({
      message: "Select skills to install:",
      choices,
      pageSize: 15,
      theme: {
        style: {
          renderSelectedChoices: (selected: Array<{ name?: string; value: unknown }>) =>
            selected.map((c) => (c.value as SkillSearchResult).name).join(", "),
        },
      },
    });
  } catch {
    log.warn("Installation cancelled");
    return;
  }

  const uniqueSkills = selectedSkills;

  if (uniqueSkills.length === 0) {
    log.warn("No skills selected");
    return;
  }

  const targets = await promptForInstallTargets({});
  if (!targets) {
    log.warn("Installation cancelled");
    return;
  }

  const targetDirs = getTargetDirs(targets);

  const installSpinner = ora("Installing skills...").start();

  let permissionError = false;
  const failedDirs: Set<string> = new Set();
  const installedSkills: string[] = [];

  for (const skill of uniqueSkills) {
    try {
      installSpinner.text = `Downloading ${skill.name}...`;
      const downloadData = await downloadSkill(skill.project, skill.name);

      if (downloadData.error) {
        log.warn(`Failed to download ${skill.name}: ${downloadData.error}`);
        continue;
      }

      installSpinner.text = `Installing ${skill.name}...`;

      const [primaryDir, ...symlinkDirs] = targetDirs;

      try {
        await installSkillFiles(skill.name, downloadData.files, primaryDir);
      } catch (dirErr) {
        const error = dirErr as NodeJS.ErrnoException;
        if (error.code === "EACCES" || error.code === "EPERM") {
          permissionError = true;
          failedDirs.add(primaryDir);
        }
        throw dirErr;
      }

      const primarySkillDir = join(primaryDir, skill.name);
      for (const targetDir of symlinkDirs) {
        try {
          await symlinkSkill(skill.name, primarySkillDir, targetDir);
        } catch (dirErr) {
          const error = dirErr as NodeJS.ErrnoException;
          if (error.code === "EACCES" || error.code === "EPERM") {
            permissionError = true;
            failedDirs.add(targetDir);
          }
          throw dirErr;
        }
      }

      installedSkills.push(`${skill.project}/${skill.name}`);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EACCES" || error.code === "EPERM") {
        continue;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to install ${skill.name}: ${errMsg}`);
    }
  }

  if (permissionError) {
    installSpinner.fail("Permission denied");
    log.blank();
    log.warn("Fix permissions with:");
    for (const dir of failedDirs) {
      const parentDir = join(dir, "..");
      log.dim(`  sudo chown -R $(whoami) "${parentDir}"`);
    }
    log.blank();
    return;
  }

  installSpinner.succeed(`Installed ${installedSkills.length} skill(s)`);
  trackInstalls(installedSkills, targets.ides);

  const installedNames = uniqueSkills.map((s) => s.name);
  logInstallSummary(targets, targetDirs, installedNames);
}

async function listCommand(options: ListOptions): Promise<void> {
  const target = await promptForSingleTarget(options);
  if (!target) {
    log.warn("Cancelled");
    return;
  }

  const skillsDir = getTargetDirFromSelection(target.ide, target.scope);

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skillFolders = entries.filter((e) => e.isDirectory() || e.isSymbolicLink());

    if (skillFolders.length === 0) {
      log.warn(`No skills installed in ${skillsDir}`);
      return;
    }

    log.info(`\n◆ Installed skills (${skillsDir}):`);

    for (const folder of skillFolders) {
      log.item(folder.name);
    }

    log.success(`${skillFolders.length} skill(s) installed\n`);
  } catch {
    log.warn(`No skills directory found at ${skillsDir}`);
  }
}

async function removeCommand(name: string, options: RemoveOptions): Promise<void> {
  const target = await promptForSingleTarget(options);
  if (!target) {
    log.warn("Cancelled");
    return;
  }

  const skillsDir = getTargetDirFromSelection(target.ide, target.scope);
  const skillPath = join(skillsDir, name);

  try {
    await rm(skillPath, { recursive: true });
    log.success(`Removed skill: ${name}`);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      log.error(`Skill not found: ${name}`);
    } else if (error.code === "EACCES" || error.code === "EPERM") {
      log.error(`Permission denied. Try: sudo rm -rf "${skillPath}"`);
    } else {
      log.error(`Failed to remove skill: ${error.message}`);
    }
  }
}

async function infoCommand(input: string): Promise<void> {
  const parsed = parseSkillInput(input);
  if (!parsed) {
    log.blank();
    log.error(`Invalid input format: ${input}`);
    log.info(`Expected: /owner/repo or full GitHub URL`);
    log.blank();
    return;
  }
  const repo = `/${parsed.owner}/${parsed.repo}`;

  log.blank();
  const spinner = ora(`Fetching skills from ${repo}...`).start();

  const data = await listProjectSkills(repo);

  if (data.error) {
    spinner.fail(pc.red(`Error: ${data.message || data.error}`));
    return;
  }

  if (!data.skills || data.skills.length === 0) {
    spinner.warn(pc.yellow(`No skills found in ${repo}`));
    return;
  }

  spinner.succeed(`Found ${data.skills.length} skill(s)`);

  log.blank();
  for (const skill of data.skills) {
    log.item(skill.name);
    log.dim(`    ${skill.description || "No description"}`);
    log.dim(`    URL: ${skill.url}`);
    log.blank();
  }

  log.plain(
    `${pc.bold("Quick commands:")}\n` +
      `  Install all: ${pc.cyan(`ctx7 skills install ${repo} --all`)}\n` +
      `  Install one: ${pc.cyan(`ctx7 skills install ${repo} ${data.skills[0]?.name}`)}\n`
  );
}
