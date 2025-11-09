import "dotenv/config";
import { readFileSync, mkdirSync, renameSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { simulate } from "./simulate.js";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the current git branch name
 * @returns The branch name or "unknown" if not in a git repo
 */
function getCurrentBranch(): string {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    return branch;
  } catch (error) {
    return "unknown";
  }
}

/**
 * Runs benchmarks by simulating questions from questions.txt
 *
 * Usage:
 * - npm run benchmark openai
 * - npm run benchmark claude
 * - npm run benchmark gemini
 * - npm run benchmark openai --test (run only first question)
 */
async function runBenchmark() {
  // Parse arguments
  const args = process.argv.slice(2);
  const modelArg = args.find((a) => !a.startsWith("--"))?.toLowerCase() || "claude";
  const isTestMode = args.includes("--test");

  let scoringModel;
  let modelName;

  if (modelArg === "openai") {
    scoringModel = openai("gpt-5");
    modelName = "GPT-5";
  } else if (modelArg === "gemini") {
    scoringModel = google("gemini-2.5-pro");
    modelName = "GEMINI-2.5-PRO";
  } else {
    // Default to claude
    scoringModel = anthropic("claude-sonnet-4-5");
    modelName = "CLAUDE-SONNET-4.5";
  }

  console.log("=".repeat(80));
  console.log("Context7 MCP Benchmark");
  console.log("=".repeat(80));
  console.log(`Scoring Model: ${modelName}`);
  if (isTestMode) {
    console.log(`Mode: TEST (first question only)`);
  }
  console.log();

  // Read questions from questions.txt (in src/test directory)
  const questionsPath = join(dirname(dirname(__dirname)), "src", "test", "questions.txt");
  console.log(`Reading questions from: ${questionsPath}`);

  if (!existsSync(questionsPath)) {
    console.error(`Error: questions.txt not found at ${questionsPath}`);
    process.exit(1);
  }

  const questionsContent = readFileSync(questionsPath, "utf-8");
  let questions = questionsContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")); // Filter empty lines and comments

  // Limit to first question if in test mode
  if (isTestMode) {
    questions = questions.slice(0, 1);
    console.log(`Test mode: Running only first question`);
  } else {
    console.log(`Found ${questions.length} questions to benchmark`);
  }
  console.log();

  // Get current git branch name
  const branchName = getCurrentBranch();

  // Create benchmark run directory with branch name and model name
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
  const benchmarkRunDir = join(
    dirname(dirname(__dirname)),
    "reports",
    "benchmarks",
    `${branchName}-run-${timestamp}_${modelName.replace(/[.\s]/g, "-")}`
  );
  mkdirSync(benchmarkRunDir, { recursive: true });
  console.log(`Benchmark results will be saved to: ${benchmarkRunDir}`);
  console.log();

  // Track results for scoring
  interface QuestionResult {
    questionNum: number;
    question: string;
    toolCount: number;
    tokenCount: number;
    score: number;
  }
  const results: QuestionResult[] = [];

  // Run simulation for questions in batches of 5 (parallel processing)
  const startTime = Date.now();
  const BATCH_SIZE = 5;

  for (let batchStart = 0; batchStart < questions.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, questions.length);
    const batch = questions.slice(batchStart, batchEnd);

    console.log("═".repeat(80));
    console.log(
      `Processing Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (Questions ${batchStart + 1}-${batchEnd})`
    );
    console.log("═".repeat(80));
    console.log();

    // Process batch in parallel
    const batchPromises = batch.map(async (question, batchIndex) => {
      const questionNum = batchStart + batchIndex + 1;

      console.log(`[Q${questionNum}] Starting: ${question.substring(0, 60)}...`);

      try {
        // Run simulation with unique ID to prevent filename collisions
        const uniqueId = `q${questionNum}`;
        await simulate(question, uniqueId);

        // Wait a bit to ensure file system operations complete
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Find the report files created for this question by unique ID
        const reportsDir = join(dirname(dirname(__dirname)), "reports");
        const files = readdirSync(reportsDir);

        // Look for files containing the unique ID
        const mdFile = files.find((f) => f.includes(`_${uniqueId}.md`) && !f.endsWith("_raw.md"));
        const rawMdFile = files.find((f) => f.includes(`_${uniqueId}_raw.md`));

        if (mdFile && rawMdFile) {
          // Move files to benchmark directory with new names
          const sourceMd = join(reportsDir, mdFile);
          const sourceRawMd = join(reportsDir, rawMdFile);
          const destMd = join(benchmarkRunDir, `q${questionNum}.md`);
          const destRawMd = join(benchmarkRunDir, `q${questionNum}_raw.md`);

          renameSync(sourceMd, destMd);
          renameSync(sourceRawMd, destRawMd);

          console.log(`[Q${questionNum}] ✅ Completed and saved`);

          return {
            questionNum,
            question,
            toolCount: 0, // Will be calculated during scoring
            tokenCount: 0, // Will be calculated during scoring
            score: 0, // Will be calculated during scoring
          };
        } else {
          console.error(`[Q${questionNum}] ⚠️  No report files found (expected: *_${uniqueId}.md)`);
          return null;
        }
      } catch (error) {
        console.error(`[Q${questionNum}] ❌ Error:`, error);
        return null;
      }
    });

    // Wait for all questions in this batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Add successful results to the results array
    batchResults.forEach((result) => {
      if (result) {
        results.push(result);
      }
    });

    console.log();
    console.log(
      `Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} completed: ${batchResults.filter((r) => r).length}/${batch.length} successful`
    );
    console.log();
  }

  const duration = Date.now() - startTime;

  // Scoring phase - also in batches of 5 for parallel processing
  console.log();
  console.log("=".repeat(80));
  console.log("Scoring Phase");
  console.log("=".repeat(80));
  console.log(`Using ${modelName} to score context quality...`);
  console.log();

  for (let batchStart = 0; batchStart < results.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, results.length);
    const batchResults = results.slice(batchStart, batchEnd);

    console.log(
      `Scoring Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (Questions ${batchStart + 1}-${batchEnd})`
    );

    // Process scoring in parallel
    const scoringPromises = batchResults.map(async (result) => {
      const rawMdPath = join(benchmarkRunDir, `q${result.questionNum}_raw.md`);
      const structuredMdPath = join(benchmarkRunDir, `q${result.questionNum}.md`);

      try {
        // Read raw markdown file
        const rawContent = readFileSync(rawMdPath, "utf-8");

        // Count tokens (approximate: split by whitespace and punctuation)
        const tokenCount = rawContent.split(/[\s\n]+/).length;
        result.tokenCount = tokenCount;

        // Count tool calls from structured report
        const structuredContent = readFileSync(structuredMdPath, "utf-8");
        const toolCallMatches = structuredContent.match(/### Tool Call \d+:/g);
        result.toolCount = toolCallMatches ? toolCallMatches.length : 0;

        // Extract question and context from raw file
        const lines = rawContent.split("\n");
        const questionLine = lines.find((line) => line.startsWith("QUESTION:"));
        const question = questionLine
          ? questionLine.replace("QUESTION:", "").trim()
          : result.question;

        // Get context (everything after "CONTEXT:")
        const contextStart = rawContent.indexOf("CONTEXT:");
        const context =
          contextStart !== -1 ? rawContent.substring(contextStart + 8).trim() : rawContent;

        console.log(`[Q${result.questionNum}] Scoring...`);

        // Ask the scoring model to evaluate the context
        const scoringResult = await generateText({
          model: scoringModel,
          messages: [
            {
              role: "user",
              content: `You are evaluating the quality and usefulness of documentation context for a given question.

Question: ${question}

Context provided:
${context}

Rate how helpful and relevant this context is for answering the question on a scale of 1-10, where:
- 1-3: Poor - Missing critical information, irrelevant, or unhelpful
- 4-6: Adequate - Has some useful information but gaps exist
- 7-8: Good - Covers most needs with relevant examples
- 9-10: Excellent - Comprehensive, relevant, with clear examples

Respond with ONLY a JSON object in this format:
{"score": <number>, "reasoning": "<brief explanation>"}`,
            },
          ],
        });

        // Parse the score
        try {
          const jsonMatch = scoringResult.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const scoreData = JSON.parse(jsonMatch[0]);
            result.score = scoreData.score;
            console.log(
              `[Q${result.questionNum}] Score: ${scoreData.score}/10 - ${scoreData.reasoning.substring(0, 60)}...`
            );
          } else {
            console.log(`[Q${result.questionNum}] ⚠️  Could not parse score, defaulting to 0`);
            result.score = 0;
          }
        } catch (parseError) {
          console.log(`[Q${result.questionNum}] ⚠️  Error parsing score: ${parseError}`);
          result.score = 0;
        }
      } catch (error) {
        console.error(`[Q${result.questionNum}] ❌ Error scoring:`, error);
      }
    });

    // Wait for all scoring in this batch to complete
    await Promise.all(scoringPromises);

    console.log(
      `Scoring Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} completed: ${batchEnd - batchStart} questions`
    );
    console.log();
  }

  // Calculate averages
  const avgToolCount = results.reduce((sum, r) => sum + r.toolCount, 0) / results.length;
  const avgTokenCount = results.reduce((sum, r) => sum + r.tokenCount, 0) / results.length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  // Generate result.md
  console.log("Generating result.md...");
  let resultMd = `# Benchmark Results\n\n`;
  resultMd += `**Scoring Model**: ${modelName}\n`;
  resultMd += `**Date**: ${new Date().toISOString()}\n`;
  resultMd += `**Total Questions**: ${results.length}\n`;
  resultMd += `**Total Duration**: ${(duration / 1000).toFixed(2)}s\n\n`;

  resultMd += `## Averages\n\n`;
  resultMd += `| Metric | Value |\n`;
  resultMd += `|--------|-------|\n`;
  resultMd += `| Average Tool Calls | ${avgToolCount.toFixed(2)} |\n`;
  resultMd += `| Average Token Count | ${avgTokenCount.toFixed(0)} |\n`;
  resultMd += `| Average Score | ${avgScore.toFixed(2)}/10 |\n\n`;

  resultMd += `## Results by Question\n\n`;
  results.forEach((result) => {
    resultMd += `### Q${result.questionNum}: ${result.question}\n\n`;
    resultMd += `| Metric | Value |\n`;
    resultMd += `|--------|-------|\n`;
    resultMd += `| Tool Calls | ${result.toolCount} |\n`;
    resultMd += `| Token Count | ${result.tokenCount} |\n`;
    resultMd += `| LLM Score | ${result.score}/10 |\n\n`;
  });

  const resultPath = join(benchmarkRunDir, "result.md");
  writeFileSync(resultPath, resultMd);
  console.log(`✅ Results saved to: ${resultPath}`);
  console.log();

  // Summary
  console.log("=".repeat(80));
  console.log("Benchmark Complete");
  console.log("=".repeat(80));
  console.log(`Scoring Model: ${modelName}`);
  console.log(`Total questions: ${questions.length}`);
  console.log(`Total time: ${(duration / 1000).toFixed(2)}s`);
  console.log(`Average time per question: ${(duration / questions.length / 1000).toFixed(2)}s`);
  console.log();
  console.log(`📊 Scoring Results:`);
  console.log(`  - Average Tool Calls: ${avgToolCount.toFixed(2)}`);
  console.log(`  - Average Token Count: ${avgTokenCount.toFixed(0)}`);
  console.log(`  - Average Score: ${avgScore.toFixed(2)}/10`);
  console.log();
  console.log(`Results saved to: ${benchmarkRunDir}`);
  console.log("=".repeat(80));
}

// Run benchmark
runBenchmark().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
