import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { mkdir, writeFile, readFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { input, select } from "@inquirer/prompts";

import {
  searchLibraries,
  getSkillQuestions,
  generateSkillStructured,
  getSkillQuota,
} from "../utils/api.js";
import { loadTokens, isTokenExpired } from "../utils/auth.js";
import { performLogin } from "./auth.js";
import { log } from "../utils/logger.js";
import { promptForInstallTargets, getTargetDirs } from "../utils/ide.js";
import selectOrInput from "../utils/selectOrInput.js";
import { checkboxWithHover, terminalLink } from "../utils/prompts.js";
import { trackEvent } from "../utils/tracking.js";
import type {
  GenerateOptions,
  LibrarySearchResult,
  SkillAnswer,
  StructuredGenerateInput,
  GenerateStreamEvent,
  ToolResultSnippet,
} from "../types.js";

interface QueryLogEntry {
  query: string;
  libraryId?: string;
  results: ToolResultSnippet[];
}

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
  trackEvent("command", { name: "generate" });
  log.blank();

  let accessToken: string | null = null;
  const tokens = loadTokens();
  if (tokens && !isTokenExpired(tokens)) {
    accessToken = tokens.access_token;
  } else {
    log.info("Authentication required. Logging in...");
    log.blank();
    accessToken = await performLogin();
    if (!accessToken) {
      log.error("Login failed. Please try again.");
      return;
    }
    log.blank();
  }

  const initSpinner = ora().start();
  const quota = await getSkillQuota(accessToken);

  if (quota.error) {
    initSpinner.fail(pc.red("Failed to initialize"));
    return;
  }

  if (quota.tier !== "unlimited" && quota.remaining < 1) {
    initSpinner.fail(pc.red("Weekly skill generation limit reached"));
    log.blank();
    console.log(
      `  You've used ${pc.bold(pc.white(quota.used.toString()))}/${pc.bold(pc.white(quota.limit.toString()))} skill generations this week.`
    );
    console.log(
      `  Your quota resets on ${pc.yellow(new Date(quota.resetDate!).toLocaleDateString())}.`
    );
    log.blank();
    if (quota.tier === "free") {
      console.log(
        `  ${pc.yellow("Tip:")} Upgrade to Pro for ${pc.bold("10")} generations per week.`
      );
      console.log(`  Visit ${pc.green("https://context7.com/dashboard")} to upgrade.`);
    }
    return;
  }

  initSpinner.stop();
  initSpinner.clear();

  console.log(pc.bold("What should your agent become an expert at?\n"));
  console.log(
    pc.dim(
      "Skills should encode best practices, constraints, and decision-making —\nnot step-by-step tutorials or one-off tasks.\n"
    )
  );
  console.log(pc.yellow("Examples:"));
  // prettier-ignore
  {
    console.log(pc.red('  ✕ "Deploy a Next.js app to Vercel"'));
    console.log(pc.green('  ✓ "Best practices and constraints for deploying Next.js apps to Vercel"'));
    log.blank();
    console.log(pc.red('  ✕ "Use Tailwind for responsive design"'));
    console.log(pc.green('  ✓ "Responsive layout decision-making with Tailwind CSS"'));
    log.blank();
    console.log(pc.red('  ✕ "Build OAuth with NextAuth"'));
    console.log(pc.green('  ✓ "OAuth authentication patterns and pitfalls with NextAuth.js"'));
  }
  log.blank();

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

  log.blank();
  console.log(
    pc.dim(
      "To generate this skill, we will read relevant documentation and examples\nfrom Context7.\n"
    )
  );
  console.log(
    pc.dim(
      "These sources are used to:\n• extract best practices and constraints\n• compare patterns across official docs and examples\n• avoid outdated or incorrect guidance\n"
    )
  );
  console.log(pc.dim("You can adjust which sources the skill is based on.\n"));

  const searchSpinner = ora("Finding relevant sources...").start();
  const searchResult = await searchLibraries(motivation, accessToken);

  if (searchResult.error || !searchResult.results?.length) {
    searchSpinner.fail(pc.red("No sources found"));
    log.warn(searchResult.message || "Try a different description");
    return;
  }

  searchSpinner.succeed(pc.green(`Found ${searchResult.results.length} relevant sources`));
  log.blank();

  let selectedLibraries: LibrarySearchResult[];
  try {
    const formatProjectId = (id: string) => {
      return id.startsWith("/") ? id.slice(1) : id;
    };

    const isGitHubRepo = (id: string): boolean => {
      const cleanId = id.startsWith("/") ? id.slice(1) : id;
      const parts = cleanId.split("/");
      if (parts.length !== 2) return false;
      const nonGitHubPrefixes = ["websites", "packages", "npm", "docs", "libraries", "llmstxt"];
      return !nonGitHubPrefixes.includes(parts[0].toLowerCase());
    };

    const libraries = searchResult.results.slice(0, 5);
    const indexWidth = libraries.length.toString().length;
    const maxNameLen = Math.max(...libraries.map((lib) => lib.title.length));

    const libraryChoices = libraries.map((lib, index) => {
      const projectId = formatProjectId(lib.id);
      const isGitHub = isGitHubRepo(lib.id);
      const indexStr = pc.dim(`${(index + 1).toString().padStart(indexWidth)}.`);
      const paddedName = lib.title.padEnd(maxNameLen);

      const libUrl = `https://context7.com${lib.id}`;
      const libLink = terminalLink(lib.title, libUrl, pc.white);
      const sourceUrl = isGitHub
        ? `https://github.com/${projectId}`
        : `https://context7.com${lib.id}`;
      const repoLink = terminalLink(projectId, sourceUrl, pc.white);

      const starsLine =
        lib.stars && isGitHub ? [`${pc.yellow("Stars:")}       ${lib.stars.toLocaleString()}`] : [];

      const metadataLines = [
        pc.dim("─".repeat(50)),
        "",
        `${pc.yellow("Library:")}     ${libLink}`,
        `${pc.yellow("Source:")}      ${repoLink}`,
        `${pc.yellow("Snippets:")}    ${lib.totalSnippets.toLocaleString()}`,
        ...starsLine,
        `${pc.yellow("Description:")}`,
        pc.white(lib.description || "No description"),
      ];

      return {
        name: `${indexStr} ${paddedName}  ${pc.dim(`(${projectId})`)}`,
        value: lib,
        description: metadataLines.join("\n"),
      };
    });

    selectedLibraries = await checkboxWithHover(
      {
        message: "Select sources:",
        choices: libraryChoices,
        pageSize: 10,
        loop: false,
      },
      { getName: (lib) => `${lib.title} (${formatProjectId(lib.id)})` }
    );

    if (!selectedLibraries || selectedLibraries.length === 0) {
      log.info("No sources selected. Try running the command again.");
      return;
    }
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  log.blank();

  const questionsSpinner = ora(
    "Preparing follow-up questions to clarify scope and constraints..."
  ).start();
  const librariesInput = selectedLibraries.map((lib) => ({ id: lib.id, name: lib.title }));
  const questionsResult = await getSkillQuestions(librariesInput, motivation, accessToken);

  if (questionsResult.error || !questionsResult.questions?.length) {
    questionsSpinner.fail(pc.red("Failed to generate questions"));
    log.warn(questionsResult.message || "Please try again");
    return;
  }

  questionsSpinner.succeed(pc.green("Questions prepared"));
  log.blank();

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

      const linesToClear = 3 + q.options.length;
      process.stdout.write(`\x1b[${linesToClear}A\x1b[J`);

      const truncatedAnswer = answer.length > 50 ? answer.slice(0, 47) + "..." : answer;
      console.log(`${pc.green("✓")} ${pc.dim(`[${questionNum}/${totalQuestions}]`)} ${q.question}`);
      console.log(`  ${pc.cyan(truncatedAnswer)}`);
      log.blank();
    }
  } catch {
    log.warn("Generation cancelled");
    return;
  }

  let generatedContent: string | null = null;
  let skillName: string = "";
  let feedback: string | undefined;
  let previewFile: string | null = null;
  let previewFileWritten = false;

  const cleanupPreviewFile = async () => {
    if (previewFile) {
      await unlink(previewFile).catch(() => {});
    }
  };

  const queryLog: QueryLogEntry[] = [];
  let genSpinner: ReturnType<typeof ora> | null = null;

  const formatQueryLogText = (): string => {
    if (queryLog.length === 0) return "";

    const lines: string[] = [];
    const latestEntry = queryLog[queryLog.length - 1];

    lines.push("");

    for (const result of latestEntry.results.slice(0, 3)) {
      const cleanContent = result.content.replace(/Source:\s*https?:\/\/[^\s]+/gi, "").trim();
      if (cleanContent) {
        lines.push(`  ${pc.yellow("•")} ${pc.white(result.title)}`);
        const maxLen = 400;
        const content =
          cleanContent.length > maxLen ? cleanContent.slice(0, maxLen - 3) + "..." : cleanContent;
        const words = content.split(" ");
        let currentLine = "    ";
        for (const word of words) {
          if (currentLine.length + word.length > 84) {
            lines.push(pc.dim(currentLine));
            currentLine = "    " + word + " ";
          } else {
            currentLine += word + " ";
          }
        }
        if (currentLine.trim()) {
          lines.push(pc.dim(currentLine));
        }
        lines.push("");
      }
    }

    return "\n" + lines.join("\n");
  };

  let isGeneratingContent = false;
  let initialStatus = "Reading selected Context7 sources to generate the skill...";

  const handleStreamEvent = (event: GenerateStreamEvent) => {
    if (event.type === "progress") {
      if (genSpinner) {
        if (event.message.startsWith("Generating skill content...") && !isGeneratingContent) {
          isGeneratingContent = true;
          if (queryLog.length > 0) {
            genSpinner.succeed(pc.green(`Read Context7 sources`));
          } else {
            genSpinner.succeed(pc.green(`Ready to generate`));
          }
          genSpinner = ora("Generating skill content...").start();
        } else if (!isGeneratingContent) {
          genSpinner.text = initialStatus + formatQueryLogText();
        }
      }
    } else if (event.type === "tool_result") {
      queryLog.push({
        query: event.query,
        libraryId: event.libraryId,
        results: event.results,
      });
      if (genSpinner && !isGeneratingContent) {
        genSpinner.text = genSpinner.text.split("\n")[0] + formatQueryLogText();
      }
    }
  };

  while (true) {
    const generateInput: StructuredGenerateInput = {
      motivation,
      libraries: librariesInput,
      answers,
      feedback,
      previousContent: feedback && generatedContent ? generatedContent : undefined,
    };

    queryLog.length = 0;
    isGeneratingContent = false;
    previewFileWritten = false;
    initialStatus = feedback
      ? "Regenerating skill with your feedback..."
      : "Reading selected Context7 sources to generate the skill...";

    genSpinner = ora(initialStatus).start();

    const result = await generateSkillStructured(generateInput, handleStreamEvent, accessToken);

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

    const contentLines = generatedContent.split("\n");
    const previewLineCount = 20;
    const hasMoreLines = contentLines.length > previewLineCount;
    const previewContent = contentLines.slice(0, previewLineCount).join("\n");
    const remainingLines = contentLines.length - previewLineCount;

    const showPreview = () => {
      log.blank();
      console.log(pc.dim("━".repeat(70)));
      console.log(pc.bold(`Generated Skill: `) + pc.green(pc.bold(skillName)));
      console.log(pc.dim("━".repeat(70)));
      log.blank();
      console.log(previewContent);
      if (hasMoreLines) {
        log.blank();
        console.log(pc.dim(`... ${remainingLines} more lines`));
      }
      log.blank();
      console.log(pc.dim("━".repeat(70)));
      log.blank();
    };

    const openInEditor = async () => {
      const previewDir = join(homedir(), ".context7", "previews");
      await mkdir(previewDir, { recursive: true });
      previewFile = join(previewDir, `${skillName}.md`);
      if (!previewFileWritten) {
        await writeFile(previewFile, generatedContent!, "utf-8");
        previewFileWritten = true;
      }
      const editor = process.env.EDITOR || "open";
      await new Promise<void>((resolve) => {
        const child = spawn(editor, [previewFile!], {
          stdio: "inherit",
          shell: true,
        });
        child.on("close", () => resolve());
      });
    };

    const syncFromPreviewFile = async () => {
      if (previewFile) {
        generatedContent = await readFile(previewFile, "utf-8");
      }
    };

    showPreview();

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      let action: string;
      while (true) {
        const choices = [
          { name: `${pc.green("✓")} Install skill (save locally)`, value: "install" },
          { name: `${pc.blue("⤢")} Edit skill in editor`, value: "view" },
          { name: `${pc.yellow("✎")} Request changes`, value: "feedback" },
          { name: `${pc.red("✕")} Cancel`, value: "cancel" },
        ];

        action = await select({
          message: "What would you like to do?",
          choices,
        });

        if (action === "view") {
          await openInEditor();
          continue;
        }
        await syncFromPreviewFile();
        break;
      }

      if (action === "install") {
        break;
      } else if (action === "cancel") {
        await cleanupPreviewFile();
        log.warn("Generation cancelled");
        return;
      } else if (action === "feedback") {
        trackEvent("gen_feedback");
        feedback = await input({
          message: "What changes would you like? (press Enter to skip)",
        });

        if (!feedback.trim()) {
          feedback = undefined;
        }
        log.blank();
      }
    } catch {
      await cleanupPreviewFile();
      log.warn("Generation cancelled");
      return;
    }
  }

  const targets = await promptForInstallTargets(options);
  if (!targets) {
    log.warn("Generation cancelled");
    return;
  }

  const targetDirs = getTargetDirs(targets);

  const writeSpinner = ora("Writing skill files...").start();

  let permissionError = false;
  const failedDirs: Set<string> = new Set();

  for (const targetDir of targetDirs) {
    let finalDir = targetDir;
    if (options.output && !targetDir.includes("/.config/") && !targetDir.startsWith(homedir())) {
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
    console.log(pc.yellow("Fix permissions with:"));
    for (const dir of failedDirs) {
      const parentDir = join(dir, "..");
      console.log(pc.dim(`  sudo chown -R $(whoami) "${parentDir}"`));
    }
    log.blank();
    return;
  }

  writeSpinner.succeed(pc.green(`Created skill in ${targetDirs.length} location(s)`));
  trackEvent("gen_install");

  log.blank();
  console.log(pc.green("Skill saved successfully"));
  for (const targetDir of targetDirs) {
    console.log(pc.dim(`  ${targetDir}/`) + pc.green(skillName));
  }
  log.blank();

  await cleanupPreviewFile();
}
