import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { input, select, checkbox } from "@inquirer/prompts";

import { searchLibraries, getSkillQuestions, generateSkillStructured } from "../utils/api.js";
import { log } from "../utils/logger.js";
import { promptForInstallTargets, getTargetDirs } from "../utils/ide.js";
import selectOrInput from "../utils/selectOrInput.js";
import type {
  GenerateOptions,
  LibrarySearchResult,
  SkillAnswer,
  StructuredGenerateInput,
} from "../types.js";

export function registerGenerateCommand(skillCommand: Command): void {
  skillCommand
    .command("generate")
    .alias("gen")
    .alias("g")
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
    .action(async (options: GenerateOptions) => {
      await generateCommand(options);
    });
}

async function generateCommand(options: GenerateOptions): Promise<void> {
  log.blank();

  // Step 1: Ask for motivation/task
  console.log(pc.bold("What should your agent become an expert at?\n"));
  console.log(
    pc.dim("Skills teach agents best practices, design patterns, and domain expertise.\n")
  );
  console.log(pc.yellow("Examples:"));
  console.log(pc.dim('  "React component optimization and performance best practices"'));
  console.log(pc.dim('  "Responsive web design with Tailwind CSS"'));
  console.log(pc.dim('  "Writing effective landing page copy"'));
  console.log(pc.dim('  "Deploying Next.js apps to Vercel"'));
  console.log(pc.dim('  "OAuth authentication with NextAuth.js"\n'));

  let motivation: string;
  try {
    motivation = await input({
      message: "Describe the expertise:",
    });

    if (!motivation.trim()) {
      log.warn("Expertise description is required");
      return;
    }
    motivation = motivation.trim();
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  // Step 2: Search for libraries
  const searchSpinner = ora("Finding relevant libraries...").start();
  const searchResult = await searchLibraries(motivation);

  if (searchResult.error || !searchResult.results?.length) {
    searchSpinner.fail(pc.red("No libraries found"));
    log.warn(searchResult.message || "Try a different description");
    return;
  }

  searchSpinner.succeed(pc.green(`Found ${searchResult.results.length} relevant libraries`));
  log.blank();

  // Step 3: Library selection (multi-select)
  let selectedLibraries: LibrarySearchResult[];
  try {
    // Helper to format project ID for display
    const formatProjectId = (id: string) => {
      // id is like "/supabase/supabase-js" - clean it up
      return id.startsWith("/") ? id.slice(1) : id;
    };

    // Helper to check if a library is from GitHub
    const isGitHubRepo = (id: string): boolean => {
      // GitHub repos follow the pattern: /owner/repo
      // Non-GitHub sources might be: /websites/x, /packages/x, /npm/x, etc.
      const cleanId = id.startsWith("/") ? id.slice(1) : id;
      const parts = cleanId.split("/");

      // Must have exactly 2 parts (owner/repo)
      if (parts.length !== 2) return false;

      // Exclude category-like prefixes that aren't GitHub
      const nonGitHubPrefixes = ["websites", "packages", "npm", "docs", "libraries", "llmstxt"];
      return !nonGitHubPrefixes.includes(parts[0].toLowerCase());
    };

    const libraryChoices = searchResult.results.slice(0, 5).map((lib) => {
      const projectId = formatProjectId(lib.id);
      const isGitHub = isGitHubRepo(lib.id);
      const stars =
        lib.stars && lib.stars > 0 && isGitHub
          ? `${pc.yellow("⭐")} ${lib.stars.toLocaleString()}`
          : "";
      const snippets = `${pc.cyan("📄")} ${lib.totalSnippets.toLocaleString()}`;

      // Build description that shows at bottom with metadata (full length with wrapping)
      const desc = lib.description || "";
      const starsMetadata = stars ? `${stars}  ` : "";
      const metadata = `\n${starsMetadata}${snippets}`;
      const description = desc ? `${desc}${metadata}` : metadata;

      return {
        name: `${pc.bold(lib.title)} ${pc.dim(`(${projectId})`)}`,
        value: lib,
        description,
      };
    });

    const choices = await checkbox({
      message: "Which libraries should your agent learn from? (select one or more)",
      choices: libraryChoices,
      required: true,
      loop: false,
    });

    if (!choices || choices.length === 0) {
      log.info("No libraries selected. Try running the command again.");
      return;
    }

    selectedLibraries = choices;
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  log.blank();
  console.log(
    pc.green(
      `✓ Selected ${selectedLibraries.length} ${selectedLibraries.length === 1 ? "library" : "libraries"}:`
    )
  );
  for (const lib of selectedLibraries) {
    const projectId = lib.id.startsWith("/") ? lib.id.slice(1) : lib.id;
    console.log(pc.dim(`  • ${lib.title} (${projectId})`));
  }
  log.blank();

  // Step 4: Get clarifying questions from LLM
  const questionsSpinner = ora("Preparing clarifying questions...").start();
  const librariesInput = selectedLibraries.map((lib) => ({ id: lib.id, name: lib.title }));
  const questionsResult = await getSkillQuestions(librariesInput, motivation);

  if (questionsResult.error || !questionsResult.questions?.length) {
    questionsSpinner.fail(pc.red("Failed to generate questions"));
    log.warn(questionsResult.message || "Please try again");
    return;
  }

  questionsSpinner.succeed(pc.green("Ready for clarification"));
  log.blank();

  // Step 5: Ask clarifying questions
  const answers: SkillAnswer[] = [];
  try {
    for (let i = 0; i < questionsResult.questions.length; i++) {
      const q = questionsResult.questions[i];
      const questionNum = i + 1;
      const totalQuestions = questionsResult.questions.length;

      const answer = await selectOrInput({
        message: `${pc.dim(`[${questionNum}/${totalQuestions}]`)} ${q.question}`,
        options: q.options,
        recommendedIndex: q.recommendedIndex,
      });

      answers.push({
        question: q.question,
        answer,
      });

      log.blank();
    }
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  // Generation loop with feedback
  let generatedContent: string | null = null;
  let skillName: string = "";
  let feedback: string | undefined;

  // Build library names for display
  const libraryNames = selectedLibraries.map((lib) => lib.title).join(", ");

  while (true) {
    // Step 6: Generate the skill
    const generateInput: StructuredGenerateInput = {
      motivation,
      libraries: librariesInput,
      answers,
      feedback,
    };

    const genSpinner = ora(
      feedback
        ? "Regenerating skill with your feedback..."
        : `Generating skill for "${libraryNames}"...`
    ).start();

    const result = await generateSkillStructured(generateInput, (message) => {
      genSpinner.text = message;
    });

    if (result.error) {
      genSpinner.fail(pc.red(`Error: ${result.error}`));
      return;
    }

    if (!result.content) {
      genSpinner.fail(pc.red("No content generated"));
      return;
    }

    genSpinner.succeed(pc.green(`Generated skill for "${result.libraryName}"`));
    generatedContent = result.content;
    skillName = result.libraryName.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    // Step 7: Print the full skill
    log.blank();
    console.log(pc.dim("━".repeat(70)));
    console.log(pc.bold(`📄 Generated Skill: `) + pc.green(pc.bold(skillName)));
    console.log(pc.dim("━".repeat(70)));
    log.blank();
    console.log(generatedContent);
    log.blank();
    console.log(pc.dim("━".repeat(70)));
    log.blank();

    // Step 8: Ask for feedback
    try {
      const action = await select({
        message: "What would you like to do?",
        choices: [
          { name: `${pc.green("✓")} Save skill`, value: "save" },
          { name: `${pc.yellow("✎")} Request changes`, value: "feedback" },
          { name: `${pc.cyan("↻")} Regenerate completely`, value: "regenerate" },
          { name: `${pc.red("✕")} Cancel`, value: "cancel" },
        ],
      });

      if (action === "save") {
        break; // Exit loop and save
      } else if (action === "cancel") {
        log.warn("Generation cancelled");
        return;
      } else if (action === "feedback") {
        feedback = await input({
          message: "What changes would you like?",
        });

        if (!feedback.trim()) {
          feedback = undefined;
        }
        log.blank();
        // Continue loop with feedback
      } else if (action === "regenerate") {
        feedback = undefined;
        log.blank();
        // Continue loop without feedback (full regenerate)
      }
    } catch {
      log.warn("Generation cancelled");
      return;
    }
  }

  // Step 9: Get target IDEs
  const targets = await promptForInstallTargets(options);
  if (!targets) {
    log.warn("Generation cancelled");
    return;
  }

  // Step 10: Write to target directories
  const targetDirs = getTargetDirs(targets);

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
      await writeFile(skillPath, generatedContent!, "utf-8");
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
    writeSpinner.fail(pc.red("Permission denied"));
    log.blank();
    console.log(pc.yellow("⚠ Fix permissions with:"));
    for (const dir of failedDirs) {
      const parentDir = join(dir, "..");
      console.log(pc.dim(`  sudo chown -R $(whoami) "${parentDir}"`));
    }
    log.blank();
    return;
  }

  writeSpinner.succeed(pc.green(`Created skill in ${targetDirs.length} location(s)`));

  log.blank();
  console.log(pc.green(pc.bold("✓ Skill saved successfully")));
  for (const targetDir of targetDirs) {
    console.log(pc.dim(`  ${targetDir}/`) + pc.green(skillName));
  }
  log.blank();
}
