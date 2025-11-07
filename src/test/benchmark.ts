import "dotenv/config";
import { readFileSync, mkdirSync, renameSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { simulate } from "./simulate.js";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Runs benchmarks by simulating questions from questions.txt
 *
 * Usage: npm run benchmark
 */
async function runBenchmark() {
  console.log("=".repeat(80));
  console.log("Context7 MCP Benchmark");
  console.log("=".repeat(80));
  console.log();

  // Read questions from questions.txt (in src/test directory)
  const questionsPath = join(dirname(dirname(__dirname)), "src", "test", "questions.txt");
  console.log(`Reading questions from: ${questionsPath}`);

  if (!existsSync(questionsPath)) {
    console.error(`Error: questions.txt not found at ${questionsPath}`);
    process.exit(1);
  }

  const questionsContent = readFileSync(questionsPath, "utf-8");
  const questions = questionsContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")); // Filter empty lines and comments

  console.log(`Found ${questions.length} questions to benchmark`);
  console.log();

  // Create benchmark run directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("Z")[0];
  const benchmarkRunDir = join(
    dirname(dirname(__dirname)),
    "reports",
    "benchmarks",
    `run-${timestamp}`
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

  // Run simulation for each question
  const startTime = Date.now();
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const questionNum = i + 1;

    console.log("─".repeat(80));
    console.log(`Question ${questionNum}/${questions.length}`);
    console.log("─".repeat(80));
    console.log(`Q: ${question}`);
    console.log();

    try {
      // Run simulation
      await simulate(question);

      // The simulate function saves reports in reports/ directory
      // We need to move them to our benchmark directory

      // Find the most recent report files in reports/ directory
      const reportsDir = join(dirname(dirname(__dirname)), "reports");
      const files = readdirSync(reportsDir);

      // Find the most recent .md and _raw.md files (just created)
      const mdFiles = files
        .filter((f: string) => f.endsWith(".md") && !f.endsWith("_raw.md"))
        .sort()
        .reverse();
      const rawMdFiles = files
        .filter((f: string) => f.endsWith("_raw.md"))
        .sort()
        .reverse();

      if (mdFiles.length > 0 && rawMdFiles.length > 0) {
        const latestMd = mdFiles[0];
        const latestRawMd = rawMdFiles[0];

        // Move files to benchmark directory with new names
        const sourceMd = join(reportsDir, latestMd);
        const sourceRawMd = join(reportsDir, latestRawMd);
        const destMd = join(benchmarkRunDir, `q${questionNum}.md`);
        const destRawMd = join(benchmarkRunDir, `q${questionNum}_raw.md`);

        renameSync(sourceMd, destMd);
        renameSync(sourceRawMd, destRawMd);

        console.log(`✅ Moved reports to q${questionNum}.md and q${questionNum}_raw.md`);

        // Store result for scoring later
        results.push({
          questionNum,
          question,
          toolCount: 0, // Will be calculated during scoring
          tokenCount: 0, // Will be calculated during scoring
          score: 0, // Will be calculated during scoring
        });
      }
    } catch (error) {
      console.error(`❌ Error running simulation for question ${questionNum}:`, error);
    }

    console.log();
  }

  const duration = Date.now() - startTime;

  // Scoring phase
  console.log();
  console.log("=".repeat(80));
  console.log("Scoring Phase");
  console.log("=".repeat(80));
  console.log("Using Claude Sonnet 4.5 to score context quality...");
  console.log();

  const scoringModel = anthropic("claude-sonnet-4-5");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
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

      console.log(`Scoring Q${result.questionNum}...`);

      // Ask Claude to score the context
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
      let scoreData: { score: number; reasoning: string };
      try {
        const jsonMatch = scoringResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          scoreData = JSON.parse(jsonMatch[0]);
          result.score = scoreData.score;
          console.log(`  Score: ${scoreData.score}/10`);
          console.log(`  Reasoning: ${scoreData.reasoning.substring(0, 80)}...`);
        } else {
          console.log(`  ⚠️  Could not parse score, defaulting to 0`);
          result.score = 0;
        }
      } catch (parseError) {
        console.log(`  ⚠️  Error parsing score: ${parseError}`);
        result.score = 0;
      }
    } catch (error) {
      console.error(`❌ Error scoring Q${result.questionNum}:`, error);
    }

    console.log();
  }

  // Calculate averages
  const avgToolCount = results.reduce((sum, r) => sum + r.toolCount, 0) / results.length;
  const avgTokenCount = results.reduce((sum, r) => sum + r.tokenCount, 0) / results.length;
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  // Generate result.md
  console.log("Generating result.md...");
  let resultMd = `# Benchmark Results\n\n`;
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
