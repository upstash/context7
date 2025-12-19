import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root is two levels up from dist/benchmark/
const packageRoot = join(__dirname, "..", "..");
const ARCHIVE_PATH = join(packageRoot, "src", "benchmark", "reports", "benchmarks", "archive");

// Question sets to compare (1-8)
const QUESTION_SETS = [1, 2, 3, 4, 5, 6, 7, 8];

interface ComparisonResult {
  questionSet: number;
  questionNum: number;
  question: string;
  winner: "A" | "B" | "tie";
  reasoning: string;
}

interface QuestionSetResult {
  questionSet: number;
  winsA: number;
  winsB: number;
  ties: number;
  results: ComparisonResult[];
}

/**
 * Compare two benchmark runs across all question sets
 *
 * Usage:
 *   pnpm run compare-benchmark <prefix-a> <prefix-b>
 *
 * Example:
 *   pnpm run compare-benchmark CTX7-943-run-3 single-params-run-0
 *
 * This will compare folders:
 *   {prefix-a}-file-questions{1-8}-model-claude vs {prefix-b}-file-questions{1-8}-model-claude
 */
async function compareBenchmarks() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: pnpm run compare-benchmark <prefix-a> <prefix-b>");
    console.error("Example: pnpm run compare-benchmark CTX7-943-run-3 single-params-run-0");
    console.error("");
    console.error(
      "This compares folders matching pattern: {prefix}-file-questions{1-8}-model-claude"
    );
    process.exit(1);
  }

  const prefixA = args[0];
  const prefixB = args[1];

  console.log("=".repeat(80));
  console.log("Context7 Benchmark Comparison (All Question Sets)");
  console.log("=".repeat(80));
  console.log(`Prefix A: ${prefixA}`);
  console.log(`Prefix B: ${prefixB}`);
  console.log(`Judge: Claude Sonnet 4.5`);
  console.log(`Archive Path: ${ARCHIVE_PATH}`);
  console.log();

  const model = anthropic("claude-sonnet-4-5");
  const allResults: ComparisonResult[] = [];
  const questionSetResults: QuestionSetResult[] = [];

  // Aggregate counters
  let totalWinsA = 0;
  let totalWinsB = 0;
  let totalTies = 0;

  // Process each question set
  for (const questionSet of QUESTION_SETS) {
    const folderNameA = `${prefixA}-file-questions${questionSet}-model-claude`;
    const folderNameB = `${prefixB}-file-questions${questionSet}-model-claude`;
    const folderA = join(ARCHIVE_PATH, folderNameA);
    const folderB = join(ARCHIVE_PATH, folderNameB);

    console.log("═".repeat(80));
    console.log(`Question Set ${questionSet}`);
    console.log("═".repeat(80));

    // Check if both folders exist
    if (!existsSync(folderA)) {
      console.log(`⚠️  Skipping: Folder A not found: ${folderNameA}`);
      console.log();
      continue;
    }
    if (!existsSync(folderB)) {
      console.log(`⚠️  Skipping: Folder B not found: ${folderNameB}`);
      console.log();
      continue;
    }

    // Find all raw files in both folders
    const filesA = readdirSync(folderA).filter((f) => f.match(/^q\d+_raw\.md$/));
    const filesB = readdirSync(folderB).filter((f) => f.match(/^q\d+_raw\.md$/));

    // Get question numbers from both folders
    const questionsA = new Set(filesA.map((f) => parseInt(f.match(/q(\d+)_raw\.md/)?.[1] || "0")));
    const questionsB = new Set(filesB.map((f) => parseInt(f.match(/q(\d+)_raw\.md/)?.[1] || "0")));

    // Find common questions
    const commonQuestions = [...questionsA].filter((q) => questionsB.has(q)).sort((a, b) => a - b);

    if (commonQuestions.length === 0) {
      console.log(`⚠️  Skipping: No common questions found`);
      console.log();
      continue;
    }

    console.log(`Found ${commonQuestions.length} common questions`);

    let setWinsA = 0;
    let setWinsB = 0;
    let setTies = 0;
    const setResults: ComparisonResult[] = [];

    // Process questions in batches for parallel execution
    const BATCH_SIZE = 5;

    for (let batchStart = 0; batchStart < commonQuestions.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, commonQuestions.length);
      const batch = commonQuestions.slice(batchStart, batchEnd);

      const batchPromises = batch.map(async (questionNum) => {
        const fileA = join(folderA, `q${questionNum}_raw.md`);
        const fileB = join(folderB, `q${questionNum}_raw.md`);

        const contentA = readFileSync(fileA, "utf-8");
        const contentB = readFileSync(fileB, "utf-8");

        // Extract question from the content
        const questionMatch = contentA.match(/QUESTION:\s*(.+?)(?:\n|$)/);
        const question = questionMatch ? questionMatch[1].trim() : `Question ${questionNum}`;

        // Extract just the context part (after CONTEXT:)
        const extractContext = (content: string): string => {
          const contextStart = content.indexOf("CONTEXT:");
          if (contextStart === -1) return content;
          return content.substring(contextStart + 8).trim();
        };

        const contextA = extractContext(contentA);
        const contextB = extractContext(contentB);

        console.log(`  [Q${questionNum}] Comparing: ${question.substring(0, 45)}...`);

        try {
          const result = await generateText({
            model,
            messages: [
              {
                role: "user",
                content: `You are a technical documentation expert evaluating which context is more helpful for answering a programming question.

QUESTION: ${question}

=== ANSWER A ===
${contextA}

=== ANSWER B ===
${contextB}

Compare these two answers and determine which one is better for helping a developer answer the question. Consider:
1. Relevance - Does it directly address the question?
2. Code examples - Are there working, relevant code snippets?
3. Completeness - Does it cover the key aspects needed?
4. Clarity - Is the information well-organized and easy to understand?
5. Accuracy - Does it appear technically correct?

Respond with ONLY a JSON object in this format:
{"winner": "A" | "B" | "tie", "reasoning": "<brief 1-2 sentence explanation>"}

If both are roughly equal in quality, respond with "tie".`,
              },
            ],
          });

          // Parse the result
          const jsonMatch = result.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const rawWinner = String(parsed.winner).toUpperCase();
            const winner: "A" | "B" | "tie" =
              rawWinner === "A" ? "A" : rawWinner === "B" ? "B" : "tie";

            console.log(`  [Q${questionNum}] Winner: ${winner}`);

            return {
              questionSet,
              questionNum,
              question,
              winner,
              reasoning: parsed.reasoning,
            } as ComparisonResult;
          } else {
            console.log(`  [Q${questionNum}] ⚠️ Could not parse result, marking as tie`);
            return {
              questionSet,
              questionNum,
              question,
              winner: "tie" as const,
              reasoning: "Failed to parse LLM response",
            };
          }
        } catch (error) {
          console.error(`  [Q${questionNum}] ❌ Error:`, error);
          return {
            questionSet,
            questionNum,
            question,
            winner: "tie" as const,
            reasoning: `Error during comparison: ${error}`,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      setResults.push(...batchResults);

      // Update set counts
      batchResults.forEach((r) => {
        if (r.winner === "A") setWinsA++;
        else if (r.winner === "B") setWinsB++;
        else setTies++;
      });
    }

    // Store set results
    questionSetResults.push({
      questionSet,
      winsA: setWinsA,
      winsB: setWinsB,
      ties: setTies,
      results: setResults,
    });
    allResults.push(...setResults);

    // Update totals
    totalWinsA += setWinsA;
    totalWinsB += setWinsB;
    totalTies += setTies;

    console.log(`  Summary: A=${setWinsA}, B=${setWinsB}, Ties=${setTies}`);
    console.log();
  }

  // Generate final summary
  console.log("=".repeat(80));
  console.log("COMPARISON RESULTS");
  console.log("=".repeat(80));
  console.log();

  console.log("📊 Results by Question Set:");
  questionSetResults.forEach((qsr) => {
    console.log(`   questions${qsr.questionSet}: A=${qsr.winsA}, B=${qsr.winsB}, Ties=${qsr.ties}`);
  });
  console.log();

  console.log("📊 Aggregate Score:");
  console.log(`   ${prefixA}`);
  console.log(`   → ${totalWinsA} wins`);
  console.log();
  console.log(`   ${prefixB}`);
  console.log(`   → ${totalWinsB} wins`);
  console.log();
  console.log(`   Ties: ${totalTies}`);
  console.log();

  // Determine overall winner
  if (totalWinsA > totalWinsB) {
    console.log(`🏆 Winner: ${prefixA}`);
  } else if (totalWinsB > totalWinsA) {
    console.log(`🏆 Winner: ${prefixB}`);
  } else {
    console.log(`🤝 Result: TIE`);
  }
  console.log("=".repeat(80));

  // Generate markdown report
  let report = `# Benchmark Comparison Results\n\n`;
  report += `**Date**: ${new Date().toISOString()}\n`;
  report += `**Judge**: Claude Sonnet 4.5\n\n`;
  report += `## Prefixes Compared\n\n`;
  report += `- **Prefix A**: ${prefixA}\n`;
  report += `- **Prefix B**: ${prefixB}\n\n`;

  report += `## Aggregate Summary\n\n`;
  report += `| Prefix | Wins |\n`;
  report += `|--------|------|\n`;
  report += `| ${prefixA} | ${totalWinsA} |\n`;
  report += `| ${prefixB} | ${totalWinsB} |\n`;
  report += `| Ties | ${totalTies} |\n\n`;

  if (totalWinsA > totalWinsB) {
    report += `**Winner**: ${prefixA}\n\n`;
  } else if (totalWinsB > totalWinsA) {
    report += `**Winner**: ${prefixB}\n\n`;
  } else {
    report += `**Result**: TIE\n\n`;
  }

  report += `## Results by Question Set\n\n`;
  report += `| Question Set | A Wins | B Wins | Ties |\n`;
  report += `|--------------|--------|--------|------|\n`;
  questionSetResults.forEach((qsr) => {
    report += `| questions${qsr.questionSet} | ${qsr.winsA} | ${qsr.winsB} | ${qsr.ties} |\n`;
  });
  report += `| **Total** | **${totalWinsA}** | **${totalWinsB}** | **${totalTies}** |\n\n`;

  report += `## Detailed Results\n\n`;
  questionSetResults.forEach((qsr) => {
    report += `### Question Set ${qsr.questionSet}\n\n`;
    report += `| Q# | Question | Winner | Reasoning |\n`;
    report += `|----|----------|--------|----------|\n`;
    qsr.results.forEach((r) => {
      const shortQuestion =
        r.question.length > 35 ? r.question.substring(0, 35) + "..." : r.question;
      const winnerLabel = r.winner === "A" ? "A" : r.winner === "B" ? "B" : "Tie";
      report += `| ${r.questionNum} | ${shortQuestion} | ${winnerLabel} | ${r.reasoning.replace(/\|/g, "\\|")} |\n`;
    });
    report += `\n`;
  });

  // Save report
  const reportPath = join(ARCHIVE_PATH, `comparison-${prefixA}-vs-${prefixB}.md`);
  writeFileSync(reportPath, report);
  console.log();
  console.log(`📄 Report saved to: ${reportPath}`);
}

// Run comparison
compareBenchmarks().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
