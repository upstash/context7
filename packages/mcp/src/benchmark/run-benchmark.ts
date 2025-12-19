#!/usr/bin/env tsx

import "dotenv/config";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Check for required environment variables
if (!process.env.CONTEXT7_API_KEY) {
  console.error("Error: CONTEXT7_API_KEY environment variable is required");
  console.error("Set it in your .env file or export it in your shell");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root is two levels up from dist/benchmark/
const packageRoot = join(__dirname, "..", "..");

/**
 * Get the current git branch name
 * @returns The branch name or "unknown" if not in a git repo
 */
function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    return branch;
  } catch {
    return "unknown";
  }
}

/**
 * Find all run reports for a given branch and model
 * @param benchmarksDir The benchmarks directory path
 * @param branchName The branch name
 * @param model The model name
 * @returns Array of run report filenames with their run IDs
 */
function findExistingRuns(
  benchmarksDir: string,
  branchName: string,
  model: string
): Array<{ filename: string; runId: string }> {
  if (!existsSync(benchmarksDir)) {
    return [];
  }

  const files = readdirSync(benchmarksDir);
  const pattern = new RegExp(`^${branchName}-run-(\\d+)-model-${model}\\.md$`);
  const runs: Array<{ filename: string; runId: string }> = [];

  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      runs.push({
        filename: file,
        runId: match[1],
      });
    }
  }

  // Sort by run ID (numeric)
  runs.sort((a, b) => parseInt(a.runId, 10) - parseInt(b.runId, 10));

  return runs;
}

/**
 * Parse a run report to extract key metrics
 * @param reportPath Path to the report file
 * @returns Parsed data or null if parsing fails
 */
function parseRunReport(reportPath: string): {
  date: string;
  branchName: string;
  runId: string;
  model: string;
  questionSets: number;
  totalQuestions: number;
  totalDuration: number;
  avgToolCalls: number;
  avgTokenCount: number;
  avgTotalTokens: number;
  avgScore: number;
} | null {
  try {
    const content = readFileSync(reportPath, "utf-8");

    const dateMatch = content.match(/\*\*Date\*\*: (.+)/);
    const branchMatch = content.match(/\*\*Branch\*\*: (.+)/);
    const runIdMatch = content.match(/\*\*Run ID\*\*: (.+)/);
    const modelMatch = content.match(/\*\*Model\*\*: (.+)/);
    const questionSetsMatch = content.match(/\*\*Question Sets\*\*: (\d+)/);
    const totalQuestionsMatch = content.match(/\*\*Total Questions\*\*: (\d+)/);
    const durationMatch = content.match(/\*\*Total Duration\*\*: ([\d.]+)s/);
    const toolCallsMatch = content.match(/\| Average Tool Calls \| ([\d.]+) \|/);
    const tokenCountMatch = content.match(/\| Average Token Count \| ([\d.]+) \|/);
    const totalTokensMatch = content.match(/\| Average Total Tokens \(API\) \| ([\d.]+) \|/);
    const scoreMatch = content.match(/\| Average Score \| \*\*([\d.]+)\/10\*\* \|/);

    if (
      !dateMatch ||
      !branchMatch ||
      !runIdMatch ||
      !modelMatch ||
      !questionSetsMatch ||
      !totalQuestionsMatch ||
      !durationMatch ||
      !toolCallsMatch ||
      !tokenCountMatch ||
      !scoreMatch
    ) {
      return null;
    }

    return {
      date: dateMatch[1],
      branchName: branchMatch[1],
      runId: runIdMatch[1],
      model: modelMatch[1],
      questionSets: parseInt(questionSetsMatch[1], 10),
      totalQuestions: parseInt(totalQuestionsMatch[1], 10),
      totalDuration: parseFloat(durationMatch[1]),
      avgToolCalls: parseFloat(toolCallsMatch[1]),
      avgTokenCount: parseFloat(tokenCountMatch[1]),
      avgTotalTokens: totalTokensMatch ? parseFloat(totalTokensMatch[1]) : 0,
      avgScore: parseFloat(scoreMatch[1]),
    };
  } catch (error) {
    console.error(`Error parsing report ${reportPath}:`, error);
    return null;
  }
}

/**
 * Generate an aggregating summary report from multiple runs
 * @param benchmarksDir The benchmarks directory path
 * @param branchName The branch name
 * @param model The model name
 * @param runs The list of runs to aggregate
 * @returns The summary markdown content
 */
function generateAggregateSummary(
  benchmarksDir: string,
  branchName: string,
  model: string,
  runs: Array<{ filename: string; runId: string }>
): string {
  const runData = runs
    .map((run) => parseRunReport(join(benchmarksDir, run.filename)))
    .filter((data) => data !== null) as Array<ReturnType<typeof parseRunReport> & {}>;

  if (runData.length === 0) {
    return "";
  }

  // Calculate aggregate statistics
  const totalRuns = runData.length;
  const avgToolCalls = runData.reduce((sum, d) => sum + d.avgToolCalls, 0) / totalRuns;
  const avgTokenCount = runData.reduce((sum, d) => sum + d.avgTokenCount, 0) / totalRuns;
  const avgTotalTokens = runData.reduce((sum, d) => sum + d.avgTotalTokens, 0) / totalRuns;
  const avgScore = runData.reduce((sum, d) => sum + d.avgScore, 0) / totalRuns;
  const totalDuration = runData.reduce((sum, d) => sum + d.totalDuration, 0);
  const totalQuestions = runData.reduce((sum, d) => sum + d.totalQuestions, 0);

  // Calculate standard deviations
  const stdDevScore = Math.sqrt(
    runData.reduce((sum, d) => sum + Math.pow(d.avgScore - avgScore, 2), 0) / totalRuns
  );
  const stdDevToolCalls = Math.sqrt(
    runData.reduce((sum, d) => sum + Math.pow(d.avgToolCalls - avgToolCalls, 2), 0) / totalRuns
  );
  const stdDevTokenCount = Math.sqrt(
    runData.reduce((sum, d) => sum + Math.pow(d.avgTokenCount - avgTokenCount, 2), 0) / totalRuns
  );
  const stdDevTotalTokens = Math.sqrt(
    runData.reduce((sum, d) => sum + Math.pow(d.avgTotalTokens - avgTotalTokens, 2), 0) / totalRuns
  );

  // Get min/max scores
  const minScore = Math.min(...runData.map((d) => d.avgScore));
  const maxScore = Math.max(...runData.map((d) => d.avgScore));

  // Generate markdown
  const latestDate = runData[runData.length - 1].date;
  let md = `# Aggregate Summary Report\n\n`;
  md += `**Branch**: ${branchName}\n`;
  md += `**Model**: ${model}\n`;
  md += `**Total Runs**: ${totalRuns}\n`;
  md += `**Last Updated**: ${latestDate}\n`;
  md += `**Total Questions Across All Runs**: ${totalQuestions}\n`;
  md += `**Total Duration Across All Runs**: ${totalDuration.toFixed(2)}s (${(totalDuration / 60).toFixed(1)}m)\n\n`;

  md += `## Overall Statistics (Averaged Across ${totalRuns} Runs)\n\n`;
  md += `| Metric | Mean | Std Dev | Min | Max |\n`;
  md += `|--------|------|---------|-----|-----|\n`;
  md += `| Average Score | **${avgScore.toFixed(2)}/10** | ${stdDevScore.toFixed(2)} | ${minScore.toFixed(2)} | ${maxScore.toFixed(2)} |\n`;
  md += `| Average Tool Calls | ${avgToolCalls.toFixed(2)} | ${stdDevToolCalls.toFixed(2)} | ${Math.min(...runData.map((d) => d.avgToolCalls)).toFixed(2)} | ${Math.max(...runData.map((d) => d.avgToolCalls)).toFixed(2)} |\n`;
  md += `| Average Token Count | ${avgTokenCount.toFixed(0)} | ${stdDevTokenCount.toFixed(0)} | ${Math.min(...runData.map((d) => d.avgTokenCount)).toFixed(0)} | ${Math.max(...runData.map((d) => d.avgTokenCount)).toFixed(0)} |\n`;
  md += `| Average Total Tokens (API) | ${avgTotalTokens.toFixed(0)} | ${stdDevTotalTokens.toFixed(0)} | ${Math.min(...runData.map((d) => d.avgTotalTokens)).toFixed(0)} | ${Math.max(...runData.map((d) => d.avgTotalTokens)).toFixed(0)} |\n\n`;

  md += `## Individual Run Results\n\n`;
  md += `| Run ID | Date | Avg Score | Avg Tool Calls | Avg Token Count | Avg Total Tokens (API) | Questions | Duration |\n`;
  md += `|--------|------|-----------|----------------|-----------------|------------------------|-----------|----------|\n`;

  runData.forEach((data) => {
    md += `| ${data.runId} | ${data.date} | ${data.avgScore.toFixed(2)}/10 | ${data.avgToolCalls.toFixed(2)} | ${data.avgTokenCount.toFixed(0)} | ${data.avgTotalTokens.toFixed(0)} | ${data.totalQuestions} | ${data.totalDuration.toFixed(2)}s |\n`;
  });

  md += `\n## Run Reports\n\n`;
  runs.forEach((run) => {
    md += `- [Run ${run.runId}](${run.filename})\n`;
  });

  return md;
}

/**
 * Finds all question files in the benchmark directory
 * @param packageRoot The package root directory
 * @returns Array of question file numbers
 */
function findAllQuestionFiles(packageRoot: string): number[] {
  const benchmarkDir = join(packageRoot, "src", "benchmark", "questions");
  if (!existsSync(benchmarkDir)) {
    return [];
  }

  const files = readdirSync(benchmarkDir);
  const questionNumbers: number[] = [];
  const pattern = /^questions(\d+)\.txt$/;

  for (const file of files) {
    const match = file.match(pattern);
    if (match) {
      questionNumbers.push(parseInt(match[1], 10));
    }
  }

  // Sort numerically
  questionNumbers.sort((a, b) => a - b);
  return questionNumbers;
}

/**
 * Runs multiple benchmarks in parallel with different question sets
 *
 * Usage:
 * - pnpm run run-benchmarks claude
 *   Runs all available questions files (questions1.txt, questions2.txt, etc.) with auto-detected next run ID
 * - pnpm run run-benchmarks claude 7
 *   Runs only questions7.txt with auto-detected next run ID
 * - pnpm run run-benchmarks claude aa.txt
 *   Runs only aa.txt with auto-detected next run ID
 * - pnpm run run-benchmarks claude 7 0
 *   Runs only questions7.txt with run ID 0
 */
async function runBenchmarks() {
  const args = process.argv.slice(2);
  const model = args[0] || "claude";

  // Determine which question files to run
  let questionFiles: string[];
  let runId = args[2];

  const benchmarkDir = join(packageRoot, "src", "benchmark", "questions");

  if (args.length === 1 || args[1] === undefined) {
    // No second argument - run all question files
    const questionSets = findAllQuestionFiles(packageRoot);
    if (questionSets.length === 0) {
      console.error("No question files found in src/benchmark/questions/");
      process.exit(1);
    }
    questionFiles = questionSets.map((num) => `questions${num}.txt`);
    console.log(`Found ${questionFiles.length} question files: ${questionFiles.join(", ")}`);
  } else {
    const secondArg = args[1];
    // Check if it's a filename (contains .txt) or a number
    if (secondArg.endsWith(".txt")) {
      // Filename provided
      const filePath = join(benchmarkDir, secondArg);
      if (!existsSync(filePath)) {
        console.error(`Error: ${secondArg} not found at ${filePath}`);
        process.exit(1);
      }
      questionFiles = [secondArg];
      console.log(`Running with file: ${secondArg}`);
    } else {
      // Number provided - run that specific question set
      const questionSetNum = parseInt(secondArg, 10);
      if (isNaN(questionSetNum) || questionSetNum < 1) {
        console.error("Question set number must be a positive number");
        process.exit(1);
      }
      questionFiles = [`questions${questionSetNum}.txt`];
    }
  }

  const count = questionFiles.length;

  // Get current git branch
  const branchName = getCurrentBranch();

  // Auto-detect next run ID if not provided
  if (!runId) {
    const benchmarksDir = join(packageRoot, "src", "benchmark", "reports", "benchmarks");

    // Create benchmarks directory if it doesn't exist
    if (!existsSync(benchmarksDir)) {
      mkdirSync(benchmarksDir, { recursive: true });
    }

    const existingRuns = findExistingRuns(benchmarksDir, branchName, model);

    if (existingRuns.length === 0) {
      runId = "0";
      console.log(`No existing runs found. Starting with run ID: ${runId}`);
    } else {
      const maxRunId = Math.max(...existingRuns.map((r) => parseInt(r.runId, 10)));
      runId = (maxRunId + 1).toString();
      console.log(
        `Found ${existingRuns.length} existing runs (${existingRuns.map((r) => r.runId).join(", ")})`
      );
      console.log(`Next run ID: ${runId}`);
    }
    console.log();
  }

  console.log("=".repeat(80));
  console.log("Context7 MCP Parallel Benchmark Runner");
  console.log("=".repeat(80));
  console.log(`Model: ${model}`);
  console.log(`Branch: ${branchName}`);
  console.log(`Run ID: ${runId}`);
  console.log(`Question Files: ${count} (${questionFiles.join(", ")})`);
  console.log();

  // Validate that all question files exist
  for (const questionFile of questionFiles) {
    const questionsPath = join(benchmarkDir, questionFile);
    if (!existsSync(questionsPath)) {
      console.error(`Error: ${questionFile} not found at ${questionsPath}`);
      process.exit(1);
    }
  }

  // Create output folder names
  const outputFolders: string[] = [];
  for (const questionFile of questionFiles) {
    // Remove .txt extension for folder name
    const baseName = questionFile.replace(".txt", "");
    const folderName = `${branchName}-run-${runId}-file-${baseName}-model-${model}`;
    outputFolders.push(folderName);
  }

  console.log("Output folders:");
  outputFolders.forEach((folder, i) => {
    console.log(`  [${i + 1}] ${folder}`);
  });
  console.log();

  // Run benchmarks in parallel
  console.log("=".repeat(80));
  console.log("Starting parallel benchmarks...");
  console.log("=".repeat(80));
  console.log();

  const startTime = Date.now();

  try {
    // Run all benchmarks in parallel using Promise.all
    const benchmarkPromises = [];
    for (let i = 0; i < questionFiles.length; i++) {
      const questionFile = questionFiles[i];
      const outputFolder = outputFolders[i];

      console.log(`[${questionFile}] Starting benchmark with ${questionFile}...`);

      const promise = new Promise<void>((resolve, reject) => {
        try {
          execSync(`node dist/benchmark/benchmark.js ${model} ${questionFile} ${outputFolder}`, {
            stdio: "inherit",
            encoding: "utf-8",
            cwd: packageRoot,
          });
          console.log(`[${questionFile}] ✅ Completed`);
          resolve();
        } catch (error) {
          console.error(`[${questionFile}] ❌ Failed:`, error);
          reject(error);
        }
      });

      benchmarkPromises.push(promise);
    }

    // Wait for all benchmarks to complete
    await Promise.all(benchmarkPromises);

    const duration = Date.now() - startTime;
    console.log();
    console.log("=".repeat(80));
    console.log("All benchmarks completed!");
    console.log(`Total time: ${(duration / 1000).toFixed(2)}s`);
    console.log("=".repeat(80));
    console.log();

    // Prepare summary by combining results
    console.log("Preparing summary...");
    console.log();

    // Use combine-summaries to create a combined summary
    const benchmarksDir = join(packageRoot, "src", "benchmark", "reports", "benchmarks");

    // Collect all result.md files from the output folders
    const summaryData: Array<{
      questionFile: string;
      folder: string;
      avgToolCalls: number;
      avgTokenCount: number;
      avgTotalTokens: number;
      avgScore: number;
      totalQuestions: number;
      duration: number;
    }> = [];

    for (let i = 0; i < questionFiles.length; i++) {
      const questionFile = questionFiles[i];
      const folderPath = join(benchmarksDir, outputFolders[i]);
      const resultPath = join(folderPath, "result.md");

      if (existsSync(resultPath)) {
        // Parse result.md to extract averages
        const resultContent = readFileSync(resultPath, "utf-8");

        const toolCallsMatch = resultContent.match(/Average Tool Calls \| ([\d.]+)/);
        const tokenCountMatch = resultContent.match(/Average Token Count \| ([\d.]+)/);
        const totalTokensMatch = resultContent.match(/Average Total Tokens \(API\) \| ([\d.]+)/);
        const scoreMatch = resultContent.match(/Average Score \| ([\d.]+)\/10/);
        const questionsMatch = resultContent.match(/Total Questions\*\*: (\d+)/);
        const durationMatch = resultContent.match(/Total Duration\*\*: ([\d.]+)s/);

        summaryData.push({
          questionFile: questionFile,
          folder: outputFolders[i],
          avgToolCalls: toolCallsMatch ? parseFloat(toolCallsMatch[1]) : 0,
          avgTokenCount: tokenCountMatch ? parseFloat(tokenCountMatch[1]) : 0,
          avgTotalTokens: totalTokensMatch ? parseFloat(totalTokensMatch[1]) : 0,
          avgScore: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
          totalQuestions: questionsMatch ? parseInt(questionsMatch[1], 10) : 0,
          duration: durationMatch ? parseFloat(durationMatch[1]) : 0,
        });
      }
    }

    // Calculate overall averages
    const totalQuestions = summaryData.reduce((sum, d) => sum + d.totalQuestions, 0);
    const avgToolCalls =
      summaryData.reduce((sum, d) => sum + d.avgToolCalls, 0) / summaryData.length;
    const avgTokenCount =
      summaryData.reduce((sum, d) => sum + d.avgTokenCount, 0) / summaryData.length;
    const avgTotalTokens =
      summaryData.reduce((sum, d) => sum + d.avgTotalTokens, 0) / summaryData.length;
    const avgScore = summaryData.reduce((sum, d) => sum + d.avgScore, 0) / summaryData.length;
    const totalDuration = summaryData.reduce((sum, d) => sum + d.duration, 0);

    // Generate combined summary markdown
    const date = new Date().toISOString().split("T")[0];
    let summaryMd = `# Combined Benchmark Results\n\n`;
    summaryMd += `**Date**: ${date}\n`;
    summaryMd += `**Branch**: ${branchName}\n`;
    summaryMd += `**Run ID**: ${runId}\n`;
    summaryMd += `**Model**: ${model}\n`;
    summaryMd += `**Question Files**: ${count}\n`;
    summaryMd += `**Total Questions**: ${totalQuestions}\n`;
    summaryMd += `**Total Duration**: ${totalDuration.toFixed(2)}s (${(totalDuration / 60).toFixed(1)}m)\n\n`;

    summaryMd += `## Overall Averages\n\n`;
    summaryMd += `| Metric | Value |\n`;
    summaryMd += `|--------|-------|\n`;
    summaryMd += `| Average Tool Calls | ${avgToolCalls.toFixed(2)} |\n`;
    summaryMd += `| Average Token Count | ${avgTokenCount.toFixed(0)} |\n`;
    summaryMd += `| Average Total Tokens (API) | ${avgTotalTokens.toFixed(0)} |\n`;
    summaryMd += `| Average Score | **${avgScore.toFixed(2)}/10** |\n\n`;

    summaryMd += `## Results by Question File\n\n`;
    summaryMd += `| Question File | Avg Tool Calls | Avg Token Count | Avg Total Tokens (API) | Avg Score | Questions | Duration |\n`;
    summaryMd += `|---------------|----------------|-----------------|------------------------|-----------|-----------|----------|\n`;

    summaryData.forEach((data) => {
      summaryMd += `| ${data.questionFile} | ${data.avgToolCalls.toFixed(2)} | ${data.avgTokenCount.toFixed(0)} | ${data.avgTotalTokens.toFixed(0)} | ${data.avgScore.toFixed(2)}/10 | ${data.totalQuestions} | ${data.duration.toFixed(2)}s |\n`;
    });

    summaryMd += `\n## Output Folders\n\n`;
    summaryData.forEach((data) => {
      summaryMd += `- ${data.questionFile}: \`${data.folder}\`\n`;
    });

    // Write summary file
    const summaryFileName = `${branchName}-run-${runId}-model-${model}.md`;
    const summaryPath = join(benchmarksDir, summaryFileName);
    writeFileSync(summaryPath, summaryMd);

    console.log(`✅ Summary written to: ${summaryPath}`);
    console.log();

    // Generate aggregate summary from all runs
    console.log("Generating aggregate summary across all runs...");
    const allRuns = findExistingRuns(benchmarksDir, branchName, model);

    if (allRuns.length > 1) {
      const aggregateSummary = generateAggregateSummary(benchmarksDir, branchName, model, allRuns);

      if (aggregateSummary) {
        const aggregateSummaryFileName = `${branchName}-run-SUMMARY-model-${model}.md`;
        const aggregateSummaryPath = join(benchmarksDir, aggregateSummaryFileName);
        writeFileSync(aggregateSummaryPath, aggregateSummary);

        console.log(`✅ Aggregate summary written to: ${aggregateSummaryPath}`);
        console.log(
          `   Includes ${allRuns.length} runs: ${allRuns.map((r) => r.runId).join(", ")}`
        );
      } else {
        console.log(`⚠️  Could not generate aggregate summary (no valid run data found)`);
      }
    } else {
      console.log(`ℹ️  Only one run exists, skipping aggregate summary`);
    }
    console.log();

    // Move folders to archive
    console.log("Moving folders to archive...");
    const archiveDir = join(benchmarksDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    for (const folder of outputFolders) {
      const sourcePath = join(benchmarksDir, folder);
      const destPath = join(archiveDir, folder);

      if (existsSync(sourcePath)) {
        renameSync(sourcePath, destPath);
        console.log(`  ✅ Moved ${folder} to archive/`);
      }
    }

    console.log();
    console.log("=".repeat(80));
    console.log("Parallel Benchmark Run Complete!");
    console.log("=".repeat(80));
    console.log(`Summary: ${summaryFileName}`);
    console.log(`Overall Average Score: ${avgScore.toFixed(2)}/10`);
    if (allRuns.length > 1) {
      console.log(
        `Aggregate Summary: ${branchName}-run-SUMMARY-model-${model}.md (${allRuns.length} runs)`
      );
    }
    console.log(`Folders archived in: archive/`);
    console.log("=".repeat(80));
  } catch (error) {
    console.error("Error running benchmarks:", error);
    process.exit(1);
  }
}

// Run parallel benchmarks
runBenchmarks().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
