import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import inquirer from "inquirer";
import { mkdir, writeFile, readdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

import { parseSkillInput } from "../utils/parse-input.js";
import { getRepoSkills, searchSkills, downloadSkill } from "../utils/api.js";
import { loadConfig } from "../utils/config.js";
import type { SkillRecord, SkillFile, SkillSearchResult, IDE } from "../types.js";
import { IDE_PATHS, IDE_NAMES } from "../types.js";

interface AddOptions {
  all?: boolean;
  sync?: boolean;
  claude?: boolean;
  cursor?: boolean;
  codex?: boolean;
  opencode?: boolean;
  amp?: boolean;
  antigravity?: boolean;
  global?: boolean;
}

interface ListOptions {
  global?: boolean;
  claude?: boolean;
  cursor?: boolean;
  codex?: boolean;
  opencode?: boolean;
  amp?: boolean;
  antigravity?: boolean;
}

interface RemoveOptions {
  global?: boolean;
  claude?: boolean;
  cursor?: boolean;
  codex?: boolean;
  opencode?: boolean;
  amp?: boolean;
  antigravity?: boolean;
}

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Manage AI coding skills");

  skill
    .command("add")
    .argument("<input>", "Repo (/owner/repo), skill (/owner/repo/skill), or GitHub URL")
    .argument("[skills...]", "Specific skill names to install")
    .option("--all", "Install all skills without prompting")
    .option("--sync", "Sync latest from GitHub (refresh metadata)")
    .option("--claude", "Install to .claude/skills/ (default)")
    .option("--cursor", "Install to .cursor/skills/")
    .option("--codex", "Install to .codex/skills/")
    .option("--opencode", "Install to .opencode/skill/")
    .option("--amp", "Install to .agents/skills/")
    .option("--antigravity", "Install to .agent/skills/")
    .option("--global", "Install globally instead of project-level")
    .description("Add skills from a repository or URL")
    .action(async (input: string, skillNames: string[], options: AddOptions) => {
      await addSkills(input, skillNames, options);
    });

  skill
    .command("search")
    .argument("<query>", "Search query")
    .description("Search for skills across all indexed repositories")
    .action(async (query: string) => {
      await searchSkillsCommand(query);
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
      await listSkills(options);
    });

  skill
    .command("remove")
    .alias("rm")
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
      await removeSkill(name, options);
    });

  skill
    .command("info")
    .argument("<input>", "Repository or skill to show info for")
    .description("Show information about skills in a repository")
    .action(async (input: string) => {
      await showSkillInfo(input);
    });
}

function getSelectedIde(options: AddOptions | ListOptions | RemoveOptions): IDE | null {
  if (options.claude) return "claude";
  if (options.cursor) return "cursor";
  if ("codex" in options && options.codex) return "codex";
  if ("opencode" in options && options.opencode) return "opencode";
  if ("amp" in options && options.amp) return "amp";
  if ("antigravity" in options && options.antigravity) return "antigravity";
  return null; // no explicit selection
}

function hasExplicitIdeOption(options: AddOptions | ListOptions | RemoveOptions): boolean {
  return !!(
    options.claude ||
    options.cursor ||
    ("codex" in options && options.codex) ||
    ("opencode" in options && options.opencode) ||
    ("amp" in options && options.amp) ||
    ("antigravity" in options && options.antigravity)
  );
}

type Scope = "project" | "global";

interface InstallTargets {
  ides: IDE[];
  scopes: Scope[];
}

async function promptForInstallTargets(options: AddOptions): Promise<InstallTargets | null> {
  const config = await loadConfig();

  // If explicit IDE flags are provided, use those
  if (hasExplicitIdeOption(options)) {
    const ide = getSelectedIde(options);
    const scope: Scope =
      (options.global ?? config.defaultScope === "global") ? "global" : "project";
    return {
      ides: [ide || config.defaultIde],
      scopes: [scope],
    };
  }

  // Interactive mode: ask user for clients and scope
  console.log(""); // spacing

  // Build IDE choices
  const ideChoices = (Object.keys(IDE_NAMES) as IDE[]).map((ide) => ({
    name: `${IDE_NAMES[ide]} ${pc.dim(`(${IDE_PATHS[ide]})`)}`,
    value: ide,
    checked: ide === config.defaultIde,
  }));

  let selectedIdes: IDE[];
  try {
    const ideResult = await inquirer.prompt<{ ides: IDE[] }>([
      {
        type: "checkbox",
        name: "ides",
        message: "Which clients do you want to install the skill(s) for?",
        choices: ideChoices,
        validate: (answer: IDE[]) => {
          if (answer.length === 0) {
            return "You must select at least one client";
          }
          return true;
        },
      },
    ]);
    selectedIdes = ideResult.ides;
  } catch {
    return null; // cancelled
  }

  // Ask for scope (project and/or global) - multiselect
  let selectedScopes: Scope[];
  if (options.global !== undefined) {
    selectedScopes = options.global ? ["global"] : ["project"];
  } else {
    try {
      const scopeResult = await inquirer.prompt<{ scopes: Scope[] }>([
        {
          type: "checkbox",
          name: "scopes",
          message: "Where do you want to install?",
          choices: [
            {
              name: `Project ${pc.dim("(current directory)")}`,
              value: "project",
              checked: config.defaultScope === "project",
            },
            {
              name: `Global ${pc.dim("(home directory)")}`,
              value: "global",
              checked: config.defaultScope === "global",
            },
          ],
          validate: (answer: Scope[]) => {
            if (answer.length === 0) {
              return "You must select at least one location";
            }
            return true;
          },
        },
      ]);
      selectedScopes = scopeResult.scopes;
    } catch {
      return null; // cancelled
    }
  }

  return { ides: selectedIdes, scopes: selectedScopes };
}

function getTargetDirs(targets: InstallTargets): string[] {
  const dirs: string[] = [];
  for (const ide of targets.ides) {
    const idePath = IDE_PATHS[ide];
    for (const scope of targets.scopes) {
      if (scope === "global") {
        dirs.push(join(homedir(), idePath));
      } else {
        dirs.push(join(process.cwd(), idePath));
      }
    }
  }
  return dirs;
}

async function getTargetDir(options: AddOptions | ListOptions | RemoveOptions): Promise<string> {
  const config = await loadConfig();
  const ide = getSelectedIde(options) || config.defaultIde;
  const idePath = IDE_PATHS[ide];

  if (options.global) {
    return join(homedir(), idePath);
  }
  return join(process.cwd(), idePath);
}

async function addSkills(input: string, skillNames: string[], options: AddOptions): Promise<void> {
  const parsed = parseSkillInput(input);

  if (parsed.type === "url") {
    p.intro(pc.cyan(`Installing skill from URL...`));

    const spinner = p.spinner();
    spinner.start("Fetching skill...");

    const data = await downloadSkill(input);

    if (data.error) {
      spinner.stop(pc.red(`Error: ${data.error}`));
      return;
    }

    spinner.stop(`Fetched ${data.skill.name}`);

    // Prompt for install targets
    const targets = await promptForInstallTargets(options);
    if (!targets) {
      p.cancel("Installation cancelled");
      return;
    }

    const targetDirs = getTargetDirs(targets);
    const installSpinner = p.spinner();
    installSpinner.start("Installing skill...");

    for (const targetDir of targetDirs) {
      await installSkillFiles(data.skill.name, data.files, targetDir);
    }

    installSpinner.stop(pc.green(`Installed ${data.skill.name}`));

    const locations = targetDirs.map((d) => pc.dim(`  ${d}`)).join("\n");
    p.note(locations, "Installed to");
    p.outro("Done!");
    return;
  }

  if (parsed.type === "skill") {
    const skillId = `/${parsed.owner}/${parsed.repo}/${parsed.skillName}`;
    p.intro(pc.cyan(`Fetching skill ${skillId}...`));

    const spinner = p.spinner();
    spinner.start("Fetching skill...");

    const data = await downloadSkill(skillId);

    if (data.error) {
      spinner.stop(pc.red(`Error: ${data.error}`));
      return;
    }

    spinner.stop(`Fetched ${data.skill.name}`);

    // Prompt for install targets
    const targets = await promptForInstallTargets(options);
    if (!targets) {
      p.cancel("Installation cancelled");
      return;
    }

    const targetDirs = getTargetDirs(targets);
    const installSpinner = p.spinner();
    installSpinner.start("Installing skill...");

    for (const targetDir of targetDirs) {
      await installSkillFiles(data.skill.name, data.files, targetDir);
    }

    installSpinner.stop(pc.green(`Installed ${data.skill.name}`));

    const locations = targetDirs.map((d) => pc.dim(`  ${d}`)).join("\n");
    p.note(locations, "Installed to");
    p.outro("Done!");
    return;
  }

  const repoId = `/${parsed.owner}/${parsed.repo}`;
  p.intro(pc.cyan(`Fetching skills from ${repoId}...`));

  const spinner = p.spinner();
  spinner.start(options.sync ? "Syncing from GitHub..." : "Loading skills...");

  const data = await getRepoSkills(repoId, options.sync);

  if (data.error) {
    spinner.stop(pc.red(`Error: ${data.error}`));
    return;
  }

  if (!data.skills || data.skills.length === 0) {
    spinner.stop(pc.yellow(`No skills found in ${repoId}`));
    return;
  }

  let selectedSkills: SkillRecord[];

  // If specific skill names provided, filter and install those
  if (skillNames.length > 0) {
    selectedSkills = data.skills.filter((s) =>
      skillNames.some((name) => s.name.toLowerCase() === name.toLowerCase())
    );

    // Check for skills that weren't found
    const foundNames = selectedSkills.map((s) => s.name.toLowerCase());
    const notFound = skillNames.filter((name) => !foundNames.includes(name.toLowerCase()));

    if (selectedSkills.length === 0) {
      spinner.stop(pc.red(`Skills not found: ${skillNames.join(", ")}`));
      return;
    }

    spinner.stop(`Found ${selectedSkills.length} of ${skillNames.length} requested skill(s)`);

    if (notFound.length > 0) {
      p.log.warn(`Not found: ${notFound.join(", ")}`);
    }
  } else if (options.all) {
    const sourceLabel = data.source === "cache" ? "(cached)" : "(indexed)";
    spinner.stop(`Found ${data.skills.length} skill(s) ${sourceLabel}`);
    selectedSkills = data.skills;
  } else {
    const sourceLabel = data.source === "cache" ? "(cached)" : "(indexed)";
    spinner.stop(`Found ${data.skills.length} skill(s) ${sourceLabel}`);
    // Calculate max skill name length for alignment
    const maxNameLen = Math.min(35, Math.max(...data.skills.map((s) => s.name.length)));

    // Build inquirer choices
    const choices = data.skills.map((s) => {
      const paddedName = s.name.padEnd(maxNameLen);
      const downloads = s.installCount || 0;
      const desc = s.description?.trim()
        ? s.description.slice(0, 40) + (s.description.length > 40 ? "..." : "")
        : "No description";

      return {
        name: `${paddedName} ${pc.cyan(`↓${downloads}`)} ${pc.dim(desc)}`,
        value: s,
        short: s.name,
      };
    });

    console.log(""); // Add spacing before prompt

    try {
      const result = await inquirer.prompt<{ selectedSkills: SkillRecord[] }>([
        {
          type: "checkbox",
          name: "selectedSkills",
          message: "Select skills to install (space to select, enter to confirm):",
          choices,
          pageSize: 15,
        },
      ]);
      selectedSkills = result.selectedSkills;
    } catch {
      p.cancel("Installation cancelled");
      return;
    }
  }

  if (selectedSkills.length === 0) {
    p.log.warn("No skills selected");
    return;
  }

  // Prompt for install targets (clients and scope)
  const targets = await promptForInstallTargets(options);
  if (!targets) {
    p.cancel("Installation cancelled");
    return;
  }

  const targetDirs = getTargetDirs(targets);

  const installSpinner = p.spinner();
  installSpinner.start("Installing skills...");

  let installedCount = 0;
  for (const skill of selectedSkills) {
    try {
      installSpinner.message(`Downloading ${skill.name}...`);
      const downloadData = await downloadSkill(skill.id);

      if (downloadData.error) {
        p.log.warn(`Failed to download ${skill.name}: ${downloadData.error}`);
        continue;
      }

      installSpinner.message(`Installing ${skill.name}...`);
      for (const targetDir of targetDirs) {
        await installSkillFiles(skill.name, downloadData.files, targetDir);
      }
      installedCount++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Failed to install ${skill.name}: ${errMsg}`);
    }
  }

  installSpinner.stop(pc.green(`Installed ${installedCount} skill(s)`));

  const skillList = selectedSkills.map((s) => pc.dim(`  ${s.name}`)).join("\n");
  const locations = targetDirs.map((d) => pc.dim(`  ${d}`)).join("\n");
  p.note(`${skillList}\n\n${pc.bold("Locations:")}\n${locations}`, "Installed");

  p.outro("Done!");
}

async function installSkillFiles(
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

async function searchSkillsCommand(query: string): Promise<void> {
  p.intro(pc.cyan(`Searching for "${query}"...`));

  const spinner = p.spinner();
  spinner.start("Searching...");

  let data;
  try {
    data = await searchSkills(query);
  } catch (err) {
    spinner.stop(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  if (data.error) {
    spinner.stop(pc.red(`Error: ${data.error}`));
    return;
  }

  if (!data.results || data.results.length === 0) {
    spinner.stop(pc.yellow(`No skills found matching "${query}"`));
    p.log.info("Try adding a repository first: c7 skill add /owner/repo");
    return;
  }

  spinner.stop(`Found ${data.totalSkills} skill(s)`);

  const allSkills: SkillSearchResult[] = data.results.flatMap((r) => r.skills);

  // Group skills by repo
  const groupedByRepo = allSkills.reduce(
    (acc, skill) => {
      if (!acc[skill.repoId]) acc[skill.repoId] = [];
      acc[skill.repoId].push(skill);
      return acc;
    },
    {} as Record<string, SkillSearchResult[]>
  );

  // Build inquirer checkbox choices with separators for repos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const choices: any[] = [];

  // Calculate max skill name length for alignment
  const maxNameLen = Math.min(35, Math.max(...allSkills.map((s) => s.name.length)));

  for (const [repoId, skills] of Object.entries(groupedByRepo)) {
    // Add repo as a separator/header
    choices.push(
      new inquirer.Separator(`\n${pc.bold(pc.cyan(repoId))} ${pc.dim(`(${skills.length})`)}`)
    );

    // Add individual skills
    for (const s of skills) {
      const downloads = s.installCount || 0;
      const paddedName = s.name.padEnd(maxNameLen);
      const desc = s.description?.trim()
        ? s.description.slice(0, 40) + (s.description.length > 40 ? "..." : "")
        : "No description";

      choices.push({
        name: `${paddedName} ${pc.cyan(`↓${downloads}`)} ${pc.dim(desc)}`,
        value: s,
        short: s.name,
      });
    }
  }

  console.log(""); // Add spacing before prompt

  let selectedSkills: SkillSearchResult[];
  try {
    const result = await inquirer.prompt<{ selectedSkills: SkillSearchResult[] }>([
      {
        type: "checkbox",
        name: "selectedSkills",
        message: "Select skills to install (space to select, a to select all, enter to confirm):",
        choices,
        pageSize: 18,
      },
    ]);
    selectedSkills = result.selectedSkills;
  } catch {
    // User pressed Ctrl+C or Escape
    p.cancel("Installation cancelled");
    return;
  }

  if (selectedSkills.length === 0) {
    p.log.warn("No skills selected");
    return;
  }

  // Prompt for install targets (clients and scope)
  const targets = await promptForInstallTargets({});
  if (!targets) {
    p.cancel("Installation cancelled");
    return;
  }

  const targetDirs = getTargetDirs(targets);

  const installSpinner = p.spinner();
  installSpinner.start("Installing skills...");

  let installedCount = 0;
  for (const skill of selectedSkills) {
    try {
      installSpinner.message(`Downloading ${skill.name}...`);
      const downloadData = await downloadSkill(skill.id);

      if (downloadData.error) {
        p.log.warn(`Failed to download ${skill.name}: ${downloadData.error}`);
        continue;
      }

      installSpinner.message(`Installing ${skill.name}...`);
      for (const targetDir of targetDirs) {
        await installSkillFiles(skill.name, downloadData.files, targetDir);
      }
      installedCount++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Failed to install ${skill.name}: ${errMsg}`);
    }
  }

  installSpinner.stop(pc.green(`Installed ${installedCount} skill(s)`));

  const skillList = selectedSkills.map((s) => pc.dim(`  ${s.name}`)).join("\n");
  const locations = targetDirs.map((d) => pc.dim(`  ${d}`)).join("\n");
  p.note(`${skillList}\n\n${pc.bold("Locations:")}\n${locations}`, "Installed");

  p.outro("Done!");
}

async function listSkills(options: ListOptions): Promise<void> {
  const skillsDir = await getTargetDir(options);

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skillFolders = entries.filter((e) => e.isDirectory());

    if (skillFolders.length === 0) {
      p.log.warn(`No skills installed in ${skillsDir}`);
      return;
    }

    p.intro(pc.cyan(`Installed skills (${skillsDir}):`));

    for (const folder of skillFolders) {
      console.log(pc.green(`  ${folder.name}`));
    }

    p.outro(`${skillFolders.length} skill(s) installed`);
  } catch {
    p.log.warn(`No skills directory found at ${skillsDir}`);
  }
}

async function removeSkill(name: string, options: RemoveOptions): Promise<void> {
  const skillsDir = await getTargetDir(options);
  const skillPath = join(skillsDir, name);

  try {
    await rm(skillPath, { recursive: true });
    p.log.success(`Removed skill: ${name}`);
  } catch {
    p.log.error(`Skill not found: ${name}`);
  }
}

async function showSkillInfo(input: string): Promise<void> {
  const parsed = parseSkillInput(input);
  const repoId = `/${parsed.owner}/${parsed.repo}`;

  p.intro(pc.cyan(`Skills in ${repoId}`));

  const spinner = p.spinner();
  spinner.start("Fetching skills...");

  const data = await getRepoSkills(repoId);

  if (data.error) {
    spinner.stop(pc.red(`Error: ${data.error}`));
    return;
  }

  if (!data.skills || data.skills.length === 0) {
    spinner.stop(pc.yellow(`No skills found in ${repoId}`));
    return;
  }

  const sourceLabel = data.source === "cache" ? "(cached)" : "(indexed)";
  spinner.stop(`Found ${data.skills.length} skill(s) ${sourceLabel}`);

  console.log("");
  for (const skill of data.skills) {
    console.log(pc.green(`  ${skill.name}`));
    console.log(pc.dim(`    ${skill.description || "No description"}`));
    console.log(pc.dim(`    ID: ${skill.id}`));
    console.log(pc.dim(`    URL: ${skill.folderUrl}`));

    const extras: string[] = [];
    if (skill.hasScripts) extras.push("scripts");
    if (skill.hasReferences) extras.push("references");
    if (skill.hasAssets) extras.push("assets");
    if (extras.length > 0) {
      console.log(pc.dim(`    Includes: ${extras.join(", ")}`));
    }
    console.log("");
  }

  p.note(
    `Install all: ${pc.cyan(`c7 skill add ${repoId} --all`)}\nInstall one: ${pc.cyan(`c7 skill add ${data.skills[0]?.id}`)}`,
    "Quick commands"
  );
}
