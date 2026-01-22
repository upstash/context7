import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { input } from "@inquirer/prompts";

import { generateSkill } from "../utils/api.js";
import { log } from "../utils/logger.js";
import { promptForInstallTargets, getTargetDirs } from "../utils/ide.js";
import type { GenerateOptions, InstallTargets } from "../types.js";
import { IDE_NAMES } from "../types.js";

function logGenerateSummary(targets: InstallTargets, targetDirs: string[], skillName: string): void {
  log.blank();
  let dirIndex = 0;
  for (const ide of targets.ides) {
    for (let i = 0; i < targets.scopes.length; i++) {
      const dir = targetDirs[dirIndex++];
      log.dim(`${IDE_NAMES[ide]}: ${dir}`);
      log.itemAdd(skillName);
    }
  }
  log.blank();
}

export function registerGenerateCommand(skillCommand: Command): void {
  skillCommand
    .command("generate")
    .alias("gen")
    .alias("g")
    .argument("<library>", "Library name to generate skill for (e.g., react, express)")
    .option("-o, --output <dir>", "Output directory (default: current directory)")
    .option("--all", "Generate for all detected IDEs")
    .option("--global", "Generate in global skills directory")
    .option("--claude", "Claude Code (.claude/skills/)")
    .option("--cursor", "Cursor (.cursor/skills/)")
    .option("--codex", "Codex (.codex/skills/)")
    .option("--opencode", "OpenCode (.opencode/skills/)")
    .option("--amp", "Amp (.agents/skills/)")
    .option("--antigravity", "Antigravity (.agent/skills/)")
    .description("Generate a skill for a library using AI")
    .action(async (library: string, options: GenerateOptions) => {
      await generateCommand(library, options);
    });
}

async function generateCommand(library: string, options: GenerateOptions): Promise<void> {
  log.blank();

  // Prompt for optional topic
  let topic: string | undefined;
  try {
    const topicInput = await input({
      message: `Focus on a specific topic? ${pc.dim("(press Enter to skip)")}`,
      default: "",
    });
    topic = topicInput.trim() || undefined;
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  // Get target IDEs
  const targets = await promptForInstallTargets(options);
  if (!targets) {
    log.warn("Generation cancelled");
    return;
  }

  const topicDisplay = topic ? ` (topic: ${topic})` : "";
  const spinner = ora(`Generating skill for "${library}"${topicDisplay}...`).start();

  // Generate the skill content
  const result = await generateSkill(library, topic, (message) => {
    spinner.text = message;
  });

  if (result.error) {
    spinner.fail(pc.red(`Error: ${result.error}`));
    return;
  }

  if (!result.content) {
    spinner.fail(pc.red("No content generated"));
    return;
  }

  spinner.succeed(`Generated skill for "${result.libraryName}"`);

  // Write to target directories
  const targetDirs = getTargetDirs(targets);
  const skillName = result.libraryName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const writeSpinner = ora("Writing skill files...").start();

  let permissionError = false;
  const failedDirs: Set<string> = new Set();

  for (const targetDir of targetDirs) {
    // If output option is provided, use it as base for project-scope paths
    let finalDir = targetDir;
    if (options.output && !targetDir.includes("/.config/") && !targetDir.startsWith(homedir())) {
      // Replace cwd with custom output for project-scope paths
      finalDir = targetDir.replace(process.cwd(), options.output);
    }
    const skillDir = join(finalDir, skillName);
    const skillPath = join(skillDir, "SKILL.md");

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillPath, result.content, "utf-8");
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "EACCES" || error.code === "EPERM") {
        permissionError = true;
        failedDirs.add(skillDir);
      } else {
        log.warn(`Failed to write to ${skillPath}: ${error.message}`);
      }
    }
  }

  if (permissionError) {
    writeSpinner.fail("Permission denied");
    log.blank();
    log.warn("Fix permissions with:");
    for (const dir of failedDirs) {
      const parentDir = join(dir, "..");
      log.dim(`  sudo chown -R $(whoami) "${parentDir}"`);
    }
    log.blank();
    return;
  }

  writeSpinner.succeed(`Created skill in ${targetDirs.length} location(s)`);

  logGenerateSummary(targets, targetDirs, skillName);

  if (topic) {
    log.dim(`Topic focus: ${topic}`);
    log.blank();
  }
}
