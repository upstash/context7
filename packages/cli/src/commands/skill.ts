import { Command } from "commander";
import pc from "picocolors";
import { checkbox, Separator } from "@inquirer/prompts";
import ora from "ora";
import { readdir, rm } from "fs/promises";
import { join } from "path";

import { parseSkillInput } from "../utils/parse-input.js";
import { listProjectSkills, searchSkills, downloadSkill } from "../utils/api.js";
import { log } from "../utils/logger.js";
import {
  promptForInstallTargets,
  promptForSingleTarget,
  getTargetDirs,
  getTargetDirFromSelection,
} from "../utils/ide.js";
import { installSkillFiles, symlinkSkill } from "../utils/installer.js";
import type { Skill, SkillSearchResult, AddOptions, ListOptions, RemoveOptions } from "../types.js";

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skills").alias("skill").description("Manage AI coding skills");

  skill
    .command("install")
    .alias("i")
    .alias("add")
    .argument("<project>", "Project (/owner/repo)")
    .argument("[skills...]", "Specific skill names to install")
    .option("--all", "Install all skills without prompting")
    .option("--claude", "Install to .claude/skills/ (default)")
    .option("--cursor", "Install to .cursor/skills/")
    .option("--codex", "Install to .codex/skills/")
    .option("--opencode", "Install to .opencode/skill/")
    .option("--amp", "Install to .agents/skills/")
    .option("--antigravity", "Install to .agent/skills/")
    .option("--global", "Install globally instead of project-level")
    .description("Install skills from a project")
    .action(async (project: string, skillNames: string[], options: AddOptions) => {
      await installCommand(project, skillNames, options);
    });

  skill
    .command("search")
    .alias("s")
    .argument("<query>", "Search query")
    .description("Search for skills across all indexed projects")
    .action(async (query: string) => {
      await searchCommand(query);
    });

  skill
    .command("list")
    .alias("ls")
    .option("--claude", "List from .claude/skills/")
    .option("--cursor", "List from .cursor/skills/")
    .option("--codex", "List from .codex/skills/")
    .option("--opencode", "List from .opencode/skill/")
    .option("--amp", "List from .agents/skills/")
    .option("--antigravity", "List from .agent/skills/")
    .option("--global", "List global skills")
    .description("List installed skills")
    .action(async (options: ListOptions) => {
      await listCommand(options);
    });

  skill
    .command("remove")
    .alias("rm")
    .alias("delete")
    .argument("<name>", "Skill name to remove")
    .option("--claude", "Remove from .claude/skills/")
    .option("--cursor", "Remove from .cursor/skills/")
    .option("--codex", "Remove from .codex/skills/")
    .option("--opencode", "Remove from .opencode/skill/")
    .option("--amp", "Remove from .agents/skills/")
    .option("--antigravity", "Remove from .agent/skills/")
    .option("--global", "Remove from global skills")
    .description("Remove an installed skill")
    .action(async (name: string, options: RemoveOptions) => {
      await removeCommand(name, options);
    });

  skill
    .command("info")
    .argument("<project>", "Project to show info for (/owner/repo)")
    .description("Show information about skills in a project")
    .action(async (project: string) => {
      await infoCommand(project);
    });
}

export function registerSkillAliases(program: Command): void {
  program
    .command("si", { hidden: true })
    .argument("<project>", "Project (/owner/repo)")
    .argument("[skills...]", "Specific skill names to install")
    .option("--all", "Install all skills without prompting")
    .option("--claude", "Install to .claude/skills/ (default)")
    .option("--cursor", "Install to .cursor/skills/")
    .option("--codex", "Install to .codex/skills/")
    .option("--opencode", "Install to .opencode/skill/")
    .option("--amp", "Install to .agents/skills/")
    .option("--antigravity", "Install to .agent/skills/")
    .option("--global", "Install globally instead of project-level")
    .description("Install skills (alias for: skills install)")
    .action(async (project: string, skillNames: string[], options: AddOptions) => {
      await installCommand(project, skillNames, options);
    });

  program
    .command("ss", { hidden: true })
    .argument("<query>", "Search query")
    .description("Search for skills (alias for: skills search)")
    .action(async (query: string) => {
      await searchCommand(query);
    });
}

async function installCommand(
  input: string,
  skillNames: string[],
  options: AddOptions
): Promise<void> {
  const parsed = parseSkillInput(input);
  if (!parsed) {
    log.error(`Invalid input format: ${input}`);
    log.info(`Expected: /owner/repo or full GitHub URL`);
    log.info(`To install specific skills, use: ctx7 skills install /owner/repo skill1 skill2`);
    log.blank();
    return;
  }
  const project = `/${parsed.owner}/${parsed.repo}`;

  log.blank();
  const spinner = ora(`Fetching skills from ${project}...`).start();

  const data = await listProjectSkills(project);

  if (data.error) {
    spinner.fail(pc.red(`Error: ${data.message || data.error}`));
    return;
  }

  if (!data.skills || data.skills.length === 0) {
    spinner.warn(pc.yellow(`No skills found in ${project}`));
    return;
  }

  const skillsWithProject = data.skills.map((s) => ({ ...s, project }));

  let selectedSkills: (Skill & { project: string })[];

  if (skillNames.length > 0) {
    selectedSkills = skillsWithProject.filter((s) =>
      skillNames.some((name) => s.name.toLowerCase() === name.toLowerCase())
    );

    const foundNames = selectedSkills.map((s) => s.name.toLowerCase());
    const notFound = skillNames.filter((name) => !foundNames.includes(name.toLowerCase()));

    if (selectedSkills.length === 0) {
      spinner.fail(pc.red(`Skills not found: ${skillNames.join(", ")}`));
      return;
    }

    spinner.succeed(`Found ${selectedSkills.length} of ${skillNames.length} requested skill(s)`);

    if (notFound.length > 0) {
      log.warn(`Not found: ${notFound.join(", ")}`);
    }
  } else if (options.all || data.skills.length === 1) {
    spinner.succeed(`Found ${data.skills.length} skill(s)`);
    selectedSkills = skillsWithProject;
  } else {
    spinner.succeed(`Found ${data.skills.length} skill(s)`);
    const maxNameLen = Math.min(25, Math.max(...data.skills.map((s) => s.name.length)));
    const choices = skillsWithProject.map((s) => {
      const paddedName = s.name.padEnd(maxNameLen);
      const desc = s.description?.trim()
        ? s.description.slice(0, 60) + (s.description.length > 60 ? "..." : "")
        : "No description";

      return {
        name: `${paddedName} ${pc.dim(desc)}`,
        value: s,
        short: s.name,
      };
    });

    log.blank();

    try {
      selectedSkills = await checkbox({
        message: "Select skills to install (space to select, enter to confirm):",
        choices,
        pageSize: 15,
      });
    } catch {
      log.warn("Installation cancelled");
      return;
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

  let installedCount = 0;
  let permissionError = false;
  const failedDirs: Set<string> = new Set();

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

      installedCount++;
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

  installSpinner.succeed(`Installed ${installedCount} skill(s)`);

  const [primaryDir, ...symlinkedDirs] = targetDirs;
  const installedNames = selectedSkills.map((s) => s.name);

  log.blank();
  log.dim(primaryDir);
  for (const name of installedNames) {
    log.itemAdd(name);
  }

  for (const dir of symlinkedDirs) {
    log.dim(dir);
    for (const name of installedNames) {
      log.itemAdd(name);
    }
  }

  log.blank();
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

  const groupedByProject = data.results.reduce(
    (acc, skill) => {
      if (!acc[skill.project]) acc[skill.project] = [];
      acc[skill.project].push(skill);
      return acc;
    },
    {} as Record<string, SkillSearchResult[]>
  );

  type ChoiceValue = SkillSearchResult | { _selectAll: string };
  const choices: Array<{ name: string; value: ChoiceValue; short?: string } | Separator> = [];
  const allSkills = data.results;
  const maxNameLen = Math.min(25, Math.max(...allSkills.map((s) => s.name.length)));

  for (const [project, skills] of Object.entries(groupedByProject)) {
    choices.push(new Separator(`\n${pc.bold(pc.cyan(project))} ${pc.dim(`(${skills.length})`)}`));

    if (skills.length > 1) {
      const skillNames = skills.map((s) => s.name).join(", ");
      choices.push({
        name: pc.italic(`  ↳ Select all ${skills.length} skills from this repo`),
        value: { _selectAll: project },
        short: skillNames,
      });
    }

    for (const s of skills) {
      const paddedName = s.name.padEnd(maxNameLen);
      const desc = s.description?.trim()
        ? s.description.slice(0, 60) + (s.description.length > 60 ? "..." : "")
        : "No description";

      choices.push({
        name: `${paddedName} ${pc.dim(desc)}`,
        value: s,
      });
    }
  }

  log.blank();

  let rawSelection: ChoiceValue[];
  try {
    rawSelection = await checkbox({
      message: "Select skills to install (space to select, enter to confirm):",
      choices,
      pageSize: 18,
    });
  } catch {
    log.warn("Installation cancelled");
    return;
  }

  const selectedSkills: SkillSearchResult[] = [];
  for (const item of rawSelection) {
    if ("_selectAll" in item) {
      selectedSkills.push(...groupedByProject[item._selectAll]);
    } else {
      selectedSkills.push(item);
    }
  }

  const uniqueSkills = [
    ...new Map(selectedSkills.map((s) => [`${s.project}:${s.name}`, s])).values(),
  ];

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

  let installedCount = 0;
  let permissionError = false;
  const failedDirs: Set<string> = new Set();

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

      installedCount++;
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

  installSpinner.succeed(`Installed ${installedCount} skill(s)`);

  const [primaryDir, ...symlinkedDirs] = targetDirs;
  const installedNames = uniqueSkills.map((s) => s.name);

  log.blank();
  log.dim(primaryDir);
  for (const name of installedNames) {
    log.itemAdd(name);
  }

  for (const dir of symlinkedDirs) {
    log.dim(dir);
    for (const name of installedNames) {
      log.itemAdd(name);
    }
  }

  log.blank();
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
    const skillFolders = entries.filter((e) => e.isDirectory());

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
  const project = `/${parsed.owner}/${parsed.repo}`;

  log.blank();
  const spinner = ora(`Fetching skills from ${project}...`).start();

  const data = await listProjectSkills(project);

  if (data.error) {
    spinner.fail(pc.red(`Error: ${data.message || data.error}`));
    return;
  }

  if (!data.skills || data.skills.length === 0) {
    spinner.warn(pc.yellow(`No skills found in ${project}`));
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
      `  Install all: ${pc.cyan(`ctx7 skills install ${project} --all`)}\n` +
      `  Install one: ${pc.cyan(`ctx7 skills install ${project} ${data.skills[0]?.name}`)}\n`
  );
}
