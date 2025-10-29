import "dotenv/config";
import {
  experimental_createMCPClient as createMCPClient,
  generateText,
  stepCountIs,
  LanguageModel,
} from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("=".repeat(80));
console.log("Context7 MCP Benchmark Starting");
console.log("=".repeat(80));
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log();

// Models that will evaluate the quality of responses
const JURY_MODELS: LanguageModel[] = [openai("gpt-5"), anthropic("claude-sonnet-4-5")];
console.log(
  `Jury Models: ${JURY_MODELS.map((m) => (typeof m === "string" ? m : m.modelId)).join(", ")}`
);

const MCP_MODEL = anthropic("claude-haiku-4-5");
console.log(`MCP Model: ${typeof MCP_MODEL === "string" ? MCP_MODEL : MCP_MODEL.modelId}`);
console.log();

/**
 * Scores a single context for answering a question
 * @param question The question to answer
 * @param context The context to evaluate
 * @param model The jury model to use for evaluation
 * @returns Score (0-100) and explanation
 */
async function scoreResponse(
  question: string,
  context: string,
  model: LanguageModel
): Promise<{ score: number; explanation: string }> {
  const modelName = typeof model === "string" ? model : model.modelId;
  console.log(`      [scoreResponse] Starting with model: ${modelName}`);
  const startTime = Date.now();

  const result = await generateText({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an expert evaluator. Score how well the provided context can help answering the given question. Respond in JSON format with a score (0-100) and explanation.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nContext: ${context}\n\nProvide a score (0-100) and explanation in JSON format: {"score": number, "explanation": "string"}`,
      },
    ],
  });

  try {
    // Remove markdown code blocks if present
    let jsonText = result.text.trim();
    if (jsonText.startsWith("```")) {
      // Extract JSON from code block
      const match = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match) {
        jsonText = match[1].trim();
      }
    }

    const parsed = JSON.parse(jsonText);
    const duration = Date.now() - startTime;
    console.log(`      [scoreResponse] Completed in ${duration}ms - Score: ${parsed.score || 0}`);

    return {
      score: parsed.score || 0,
      explanation: parsed.explanation || "No explanation provided",
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`      [scoreResponse] Failed after ${duration}ms:`, error);
    console.error("      Raw response:", result.text);
    return { score: 0, explanation: "Failed to parse response" };
  }
}

/**
 * Compares two contexts and determines which one is better for answering the question
 * @param question The question to answer
 * @param context1 Context from MCP 1 (local)
 * @param context2 Context from MCP 2 (remote)
 * @param model The jury model to use for evaluation
 * @returns Scores for both contexts, the winner (1 or 2), and explanation
 */
async function compareContexts(
  question: string,
  context1: string,
  context2: string,
  model: LanguageModel
): Promise<{ score1: number; score2: number; winner: 1 | 2; explanation: string }> {
  const modelName = typeof model === "string" ? model : model.modelId;
  console.log(`      [compareContexts] Starting with model: ${modelName}`);
  const startTime = Date.now();

  const result = await generateText({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an expert evaluator comparing documentation quality. Score both contexts (0-100) for answering a question and determine which is better. Consider: relevance, completeness, code examples, clarity, and usefulness. Respond in JSON format.",
      },
      {
        role: "user",
        content: `Question: ${question}

Context 1 (Local MCP):
${context1}

Context 2 (Remote MCP):
${context2}

Score both contexts and determine the winner. Respond in JSON format: {"score1": number, "score2": number, "winner": 1 or 2, "explanation": "string"}`,
      },
    ],
  });

  try {
    // Remove markdown code blocks if present
    let jsonText = result.text.trim();
    if (jsonText.startsWith("```")) {
      // Extract JSON from code block
      const match = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (match) {
        jsonText = match[1].trim();
      }
    }

    const parsed = JSON.parse(jsonText);

    // Validate and normalize winner (handle both string and number, convert to 1 or 2)
    let winner: 1 | 2;
    const rawWinner = parsed.winner;
    if (rawWinner === 1 || rawWinner === "1") {
      winner = 1;
    } else if (rawWinner === 2 || rawWinner === "2") {
      winner = 2;
    } else {
      // If winner is invalid, determine from scores
      console.warn(`Invalid winner value: ${rawWinner}, determining from scores`);
      winner = (parsed.score2 || 0) > (parsed.score1 || 0) ? 2 : 1;
    }

    const duration = Date.now() - startTime;
    console.log(
      `      [compareContexts] Completed in ${duration}ms - Winner: MCP ${winner} (${parsed.score1 || 0} vs ${parsed.score2 || 0})`
    );

    return {
      score1: parsed.score1 || 0,
      score2: parsed.score2 || 0,
      winner,
      explanation: parsed.explanation || "No explanation provided",
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`      [compareContexts] Failed after ${duration}ms:`, error);
    console.error("      Raw response:", result.text);
    return { score1: 0, score2: 0, winner: 1, explanation: "Failed to parse response" };
  }
}

interface Question {
  library: string;
  question: string;
}

interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
}

interface MCPResult {
  context: string;
  stepCount: number;
  toolCalls: ToolCall[];
}

interface QuestionResult {
  library: string;
  question: string;
  mcp1Result: MCPResult;
  mcp2Result: MCPResult;
  mcp1Scores: Array<{ model: string; score: number; explanation: string }>;
  mcp2Scores: Array<{ model: string; score: number; explanation: string }>;
  comparisons: Array<{
    model: string;
    score1: number;
    score2: number;
    winner: 1 | 2;
    explanation: string;
  }>;
  overallWinner: 1 | 2;
}

interface ContextGenerationResult {
  context: string;
  stepCount: number;
  toolCalls: ToolCall[];
}

/**
 * Generates context for a question using the provided MCP client
 * @param mcpClient The MCP client to use for generating context
 * @param question The question to answer
 * @param mcpModel The AI model to use for generating responses
 * @returns The generated context, step count, and tool calls
 */
async function generateContextWithMCP(
  mcpClient: Awaited<ReturnType<typeof createMCPClient>>,
  question: string,
  mcpModel: LanguageModel
): Promise<ContextGenerationResult> {
  console.log(`    [generateContextWithMCP] Starting context generation`);
  const startTime = Date.now();

  // Get tools from the client
  console.log(`    [generateContextWithMCP] Fetching available tools...`);
  const tools = await mcpClient.tools();
  console.log(`    [generateContextWithMCP] Found ${Object.keys(tools).length} tools available`);

  // Track tool calls
  const toolCalls: ToolCall[] = [];

  // Generate context using MCP tools
  console.log(`    [generateContextWithMCP] Starting text generation with AI model...`);
  const result = await generateText({
    model: mcpModel,
    stopWhen: stepCountIs(5),
    tools,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Use the Context7 tools to gather relevant documentation for this question: ${question}

Do not answer the question yourself. Your task is only to:
1. Use the tools to find the most relevant documentation
2. Relay the retrieved context exactly as it is provided by the tools
3. Do not add explanations, summaries, or your own knowledge - just return the raw documentation context as is`,
          },
        ],
      },
    ],
    onStepFinish: (step) => {
      if (step.toolCalls) {
        step.toolCalls.forEach((tc) => {
          const input = (tc as any).input || (tc as any).args || {};
          const toolCall: ToolCall = {
            toolName: tc.toolName,
            args: input,
          };
          toolCalls.push(toolCall);
          console.log(`    Tool called: ${tc.toolName} with args: ${JSON.stringify(input)}`);
        });
      } else {
        console.log(`    Text generation step completed`);
      }
    },
  });

  const context = result.text;
  const stepCount = result.steps?.length || 0;
  const duration = Date.now() - startTime;

  console.log(`    [generateContextWithMCP] Completed in ${duration}ms`);
  console.log(
    `    [generateContextWithMCP] Generated ${context.length} chars in ${stepCount} steps with ${toolCalls.length} tool calls`
  );

  return {
    context,
    stepCount,
    toolCalls,
  };
}

async function runBenchmark(mcpModel: LanguageModel) {
  let mcpClient1;
  let mcpClient2;
  const results: QuestionResult[] = [];
  const mcpModelName = typeof mcpModel === "string" ? mcpModel : mcpModel.modelId;

  try {
    console.log("─".repeat(80));
    console.log("INITIALIZATION PHASE");
    console.log("─".repeat(80));

    // Load questions from source directory
    const questionsPath = join(__dirname, "../../src/bench/questions.json");
    console.log(`Loading questions from: ${questionsPath}`);
    const questionsFile = readFileSync(questionsPath, "utf-8");
    let { questions } = JSON.parse(questionsFile) as { questions: Question[] };
    console.log(`Loaded ${questions.length} questions from file`);

    questions = questions.slice(0, 100);
    console.log(`Using first ${questions.length} questions for benchmark`);

    console.log(`\n${"=".repeat(80)}`);
    console.log(`BENCHMARK CONFIGURATION`);
    console.log("=".repeat(80));
    console.log(`MCP Model: ${mcpModelName}`);
    console.log(`Total Questions: ${questions.length}`);
    console.log(
      `Jury Models: ${JURY_MODELS.map((m) => (typeof m === "string" ? m : m.modelId)).join(", ")}`
    );
    console.log("=".repeat(80));
    console.log();

    // Initialize Context7 MCP client 1 (Local Stdio)
    console.log("─".repeat(80));
    console.log("MCP CLIENT INITIALIZATION");
    console.log("─".repeat(80));
    console.log("[1/2] Initializing MCP client 1 (local stdio)...");
    console.log("      Transport: stdio");
    console.log("      Command: node dist/index.js");
    const client1StartTime = Date.now();
    mcpClient1 = await createMCPClient({
      transport: new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
      }),
    });
    console.log(
      `      ✅ Connected to Context7 MCP server (local) in ${Date.now() - client1StartTime}ms`
    );

    // Initialize Context7 MCP client 2 (Remote HTTP)
    console.log("\n[2/2] Initializing MCP client 2 (remote HTTP)...");
    console.log("      Transport: HTTP");
    console.log("      URL: https://mcp.context7.com/mcp");
    const apiKey = process.env.CONTEXT7_API_KEY;
    if (!apiKey) {
      throw new Error("CONTEXT7_API_KEY environment variable is required");
    }
    console.log(`      API Key: ${apiKey.substring(0, 10)}...`);

    const client2StartTime = Date.now();
    mcpClient2 = await createMCPClient({
      transport: new StreamableHTTPClientTransport(new URL("https://mcp.context7.com/mcp"), {
        requestInit: {
          headers: {
            "Context7-API-Key": apiKey,
          },
        },
      }),
    });
    console.log(
      `      ✅ Connected to Context7 MCP server (remote) in ${Date.now() - client2StartTime}ms`
    );
    console.log();

    // Process each question
    console.log("=".repeat(80));
    console.log("QUESTION PROCESSING PHASE");
    console.log("=".repeat(80));
    console.log();

    for (let i = 0; i < questions.length; i++) {
      const { library, question } = questions[i];
      const questionStartTime = Date.now();

      console.log("─".repeat(80));
      console.log(`QUESTION ${i + 1}/${questions.length}`);
      console.log("─".repeat(80));
      console.log(`Library: ${library}`);
      console.log(`Question: ${question}`);
      console.log(`Started at: ${new Date().toISOString()}`);
      console.log();

      try {
        // Generate context from MCP 1 (Local)
        console.log(`  [STEP 1/4] Generating context from MCP 1 (local)...`);
        const mcp1StartTime = Date.now();
        const mcp1Result = await generateContextWithMCP(mcpClient1, question, mcpModel);
        console.log(
          `            ✅ MCP 1 completed in ${Date.now() - mcp1StartTime}ms: ${mcp1Result.context.length} chars, ${mcp1Result.stepCount} steps, ${mcp1Result.toolCalls.length} tool calls`
        );
        console.log();

        // Generate context from MCP 2 (Remote)
        console.log(`  [STEP 2/4] Generating context from MCP 2 (remote)...`);
        const mcp2StartTime = Date.now();
        const mcp2Result = await generateContextWithMCP(mcpClient2, question, mcpModel);
        console.log(
          `            ✅ MCP 2 completed in ${Date.now() - mcp2StartTime}ms: ${mcp2Result.context.length} chars, ${mcp2Result.stepCount} steps, ${mcp2Result.toolCalls.length} tool calls`
        );
        console.log();

        // Score MCP 1 context individually
        console.log(`  [STEP 3/4] Scoring contexts with jury models...`);
        console.log(`            [3a] Scoring MCP 1 context...`);
        const mcp1ScoresStartTime = Date.now();
        const mcp1Scores = [];
        for (const juryModel of JURY_MODELS) {
          const juryModelName = typeof juryModel === "string" ? juryModel : juryModel.modelId;

          const scoreResult = await scoreResponse(question, mcp1Result.context, juryModel);
          mcp1Scores.push({
            model: juryModelName,
            score: scoreResult.score,
            explanation: scoreResult.explanation,
          });
        }
        console.log(
          `            ✅ MCP 1 scoring completed in ${Date.now() - mcp1ScoresStartTime}ms`
        );
        console.log(
          `               Scores: ${mcp1Scores.map((s) => `${s.model}=${s.score}`).join(", ")}`
        );
        console.log();

        // Score MCP 2 context individually
        console.log(`            [3b] Scoring MCP 2 context...`);
        const mcp2ScoresStartTime = Date.now();
        const mcp2Scores = [];
        for (const juryModel of JURY_MODELS) {
          const juryModelName = typeof juryModel === "string" ? juryModel : juryModel.modelId;

          const scoreResult = await scoreResponse(question, mcp2Result.context, juryModel);
          mcp2Scores.push({
            model: juryModelName,
            score: scoreResult.score,
            explanation: scoreResult.explanation,
          });
        }
        console.log(
          `            ✅ MCP 2 scoring completed in ${Date.now() - mcp2ScoresStartTime}ms`
        );
        console.log(
          `               Scores: ${mcp2Scores.map((s) => `${s.model}=${s.score}`).join(", ")}`
        );
        console.log();

        // Compare contexts with all jury models
        console.log(`  [STEP 4/4] Comparing contexts with jury models...`);
        const comparisonsStartTime = Date.now();
        const comparisons = [];
        for (const juryModel of JURY_MODELS) {
          const juryModelName = typeof juryModel === "string" ? juryModel : juryModel.modelId;

          const comparison = await compareContexts(
            question,
            mcp1Result.context,
            mcp2Result.context,
            juryModel
          );
          comparisons.push({
            model: juryModelName,
            score1: comparison.score1,
            score2: comparison.score2,
            winner: comparison.winner,
            explanation: comparison.explanation,
          });
        }
        console.log(
          `            ✅ Comparisons completed in ${Date.now() - comparisonsStartTime}ms`
        );
        console.log(
          `               Results: ${comparisons.map((c) => `${c.model}=MCP${c.winner}`).join(", ")}`
        );
        console.log();

        // Calculate overall winner (majority vote)
        const mcp1Wins = comparisons.filter((c) => c.winner === 1).length;
        const mcp2Wins = comparisons.filter((c) => c.winner === 2).length;
        const overallWinner: 1 | 2 = mcp1Wins > mcp2Wins ? 1 : 2;
        const questionDuration = Date.now() - questionStartTime;
        console.log(`  ✅ QUESTION ${i + 1} COMPLETED in ${(questionDuration / 1000).toFixed(2)}s`);
        console.log(`     Overall Winner: MCP ${overallWinner} (${mcp1Wins} vs ${mcp2Wins} votes)`);
        console.log();

        results.push({
          library,
          question,
          mcp1Result,
          mcp2Result,
          mcp1Scores,
          mcp2Scores,
          comparisons,
          overallWinner,
        });
      } catch (error) {
        console.error(`  Error processing question: ${error}`);
        // Skip this question on error
      }
    }

    // Calculate statistics
    const mcp1TotalWins = results.filter((r) => r.overallWinner === 1).length;
    const mcp2TotalWins = results.filter((r) => r.overallWinner === 2).length;
    const mcp1AvgScore =
      results.reduce(
        (sum, r) => sum + r.mcp1Scores.reduce((s, sc) => s + sc.score, 0) / r.mcp1Scores.length,
        0
      ) / results.length;
    const mcp2AvgScore =
      results.reduce(
        (sum, r) => sum + r.mcp2Scores.reduce((s, sc) => s + sc.score, 0) / r.mcp2Scores.length,
        0
      ) / results.length;

    // Generate timestamp and create folder structure
    console.log("\n" + "=".repeat(80));
    console.log("FILE GENERATION PHASE");
    console.log("=".repeat(80));

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T");
    const dateTime = `${timestamp[0]}_${timestamp[1].split("Z")[0]}`;
    const runFolder = join(__dirname, "results", `run_${dateTime}`);

    console.log(`Creating results folder: ${runFolder}`);
    mkdirSync(runFolder, { recursive: true });
    console.log(`✅ Results folder created successfully`);
    console.log();

    // ===== GENERATE PER-QUESTION FILES =====
    console.log("─".repeat(80));
    console.log("GENERATING PER-QUESTION FILES");
    console.log("─".repeat(80));
    console.log(`Total files to generate: ${results.length * 3} (3 per question)`);

    results.forEach((result, index) => {
      const questionNum = index + 1;
      const fileGenStartTime = Date.now();

      // Generate MCP 1 Run File
      const mcp1Path = join(runFolder, `question_${questionNum}_mcp1_run.md`);
      let mcp1Markdown = `# Question ${questionNum} - MCP 1 (Local) Results\n\n`;
      mcp1Markdown += `**Library**: ${result.library}\n`;
      mcp1Markdown += `**Question**: ${result.question}\n\n`;
      mcp1Markdown += `## Results\n\n`;
      mcp1Markdown += `- **Steps**: ${result.mcp1Result.stepCount}\n`;
      mcp1Markdown += `- **Context Length**: ${result.mcp1Result.context.length} chars\n`;
      mcp1Markdown += `- **Tool Calls**: ${result.mcp1Result.toolCalls.length}\n`;
      const mcp1AvgScore = (
        result.mcp1Scores.reduce((s, sc) => s + sc.score, 0) / result.mcp1Scores.length
      ).toFixed(1);
      mcp1Markdown += `- **Average Score**: ${mcp1AvgScore}/100\n\n`;

      mcp1Markdown += `## Call History\n\n`;
      result.mcp1Result.toolCalls.forEach((call, idx) => {
        mcp1Markdown += `${idx + 1}. **${call.toolName}**\n`;
        mcp1Markdown += `\`\`\`json\n${JSON.stringify(call.args, null, 2)}\n\`\`\`\n\n`;
      });

      mcp1Markdown += `## Jury Scores\n\n`;
      result.mcp1Scores.forEach((score) => {
        mcp1Markdown += `### ${score.model}: ${score.score}/100\n\n`;
        mcp1Markdown += `${score.explanation}\n\n`;
      });

      mcp1Markdown += `## Context\n\n`;
      mcp1Markdown += `\`\`\`\n${result.mcp1Result.context}\n\`\`\`\n`;

      writeFileSync(mcp1Path, mcp1Markdown);

      // Generate MCP 2 Run File
      const mcp2Path = join(runFolder, `question_${questionNum}_mcp2_run.md`);
      let mcp2Markdown = `# Question ${questionNum} - MCP 2 (Remote) Results\n\n`;
      mcp2Markdown += `**Library**: ${result.library}\n`;
      mcp2Markdown += `**Question**: ${result.question}\n\n`;
      mcp2Markdown += `## Results\n\n`;
      mcp2Markdown += `- **Steps**: ${result.mcp2Result.stepCount}\n`;
      mcp2Markdown += `- **Context Length**: ${result.mcp2Result.context.length} chars\n`;
      mcp2Markdown += `- **Tool Calls**: ${result.mcp2Result.toolCalls.length}\n`;
      const mcp2AvgScore = (
        result.mcp2Scores.reduce((s, sc) => s + sc.score, 0) / result.mcp2Scores.length
      ).toFixed(1);
      mcp2Markdown += `- **Average Score**: ${mcp2AvgScore}/100\n\n`;

      mcp2Markdown += `## Call History\n\n`;
      result.mcp2Result.toolCalls.forEach((call, idx) => {
        mcp2Markdown += `${idx + 1}. **${call.toolName}**\n`;
        mcp2Markdown += `\`\`\`json\n${JSON.stringify(call.args, null, 2)}\n\`\`\`\n\n`;
      });

      mcp2Markdown += `## Jury Scores\n\n`;
      result.mcp2Scores.forEach((score) => {
        mcp2Markdown += `### ${score.model}: ${score.score}/100\n\n`;
        mcp2Markdown += `${score.explanation}\n\n`;
      });

      mcp2Markdown += `## Context\n\n`;
      mcp2Markdown += `\`\`\`\n${result.mcp2Result.context}\n\`\`\`\n`;

      writeFileSync(mcp2Path, mcp2Markdown);

      // Generate Compare File
      const comparePath = join(runFolder, `question_${questionNum}_compare.md`);
      let compareMarkdown = `# Question ${questionNum} - MCP Comparison\n\n`;
      compareMarkdown += `**Library**: ${result.library}\n`;
      compareMarkdown += `**Question**: ${result.question}\n\n`;
      compareMarkdown += `**Winner**: MCP ${result.overallWinner}\n\n`;

      // Calculate average comparison scores
      const mcp1ComparisonAvg = (
        result.comparisons.reduce((s, c) => s + c.score1, 0) / result.comparisons.length
      ).toFixed(1);
      const mcp2ComparisonAvg = (
        result.comparisons.reduce((s, c) => s + c.score2, 0) / result.comparisons.length
      ).toFixed(1);

      compareMarkdown += `## Summary\n\n`;
      compareMarkdown += `| Metric | MCP 1 (Local) | MCP 2 (Remote) |\n`;
      compareMarkdown += `|--------|---------------|----------------|\n`;
      compareMarkdown += `| Steps | ${result.mcp1Result.stepCount} | ${result.mcp2Result.stepCount} |\n`;
      compareMarkdown += `| Context Length | ${result.mcp1Result.context.length} chars | ${result.mcp2Result.context.length} chars |\n`;
      compareMarkdown += `| Tool Calls | ${result.mcp1Result.toolCalls.length} | ${result.mcp2Result.toolCalls.length} |\n`;
      compareMarkdown += `| Average Score | ${mcp1ComparisonAvg}/100 | ${mcp2ComparisonAvg}/100 |\n\n`;

      compareMarkdown += `## Jury Comparisons\n\n`;
      result.comparisons.forEach((comp) => {
        compareMarkdown += `### ${comp.model}\n\n`;
        compareMarkdown += `- **Winner**: MCP ${comp.winner}\n`;
        compareMarkdown += `- **Scores**: ${comp.score1} vs ${comp.score2}\n`;
        compareMarkdown += `- **Explanation**: ${comp.explanation}\n\n`;
      });

      writeFileSync(comparePath, compareMarkdown);

      const fileGenDuration = Date.now() - fileGenStartTime;
      console.log(
        `  ✅ Question ${questionNum}/${results.length}: Generated 3 files in ${fileGenDuration}ms`
      );
    });

    // ===== GENERATE SUMMARY REPORT =====
    console.log();
    console.log("─".repeat(80));
    console.log("GENERATING SUMMARY REPORT");
    console.log("─".repeat(80));
    const summaryStartTime = Date.now();
    const summaryPath = join(runFolder, `summary.md`);
    let summaryMarkdown = `# Context7 MCP Benchmark Summary\n\n`;
    summaryMarkdown += `## Specification\n\n`;
    summaryMarkdown += `- **MCP Model**: ${mcpModelName}\n`;
    summaryMarkdown += `- **Jury Models**: ${JURY_MODELS.map((m) => (typeof m === "string" ? m : m.modelId)).join(", ")}\n`;
    summaryMarkdown += `- **Total Questions**: ${questions.length}\n`;
    summaryMarkdown += `- **Date**: ${new Date().toISOString()}\n\n`;

    summaryMarkdown += `## Overall Results\n\n`;
    summaryMarkdown += `- **MCP 1 (Local) Wins**: ${mcp1TotalWins}\n`;
    summaryMarkdown += `- **MCP 2 (Remote) Wins**: ${mcp2TotalWins}\n`;
    summaryMarkdown += `- **Overall Winner**: ${mcp1TotalWins > mcp2TotalWins ? "MCP 1 (Local)" : "MCP 2 (Remote)"}\n\n`;
    summaryMarkdown += `- **MCP 1 (Local) Average Score**: ${mcp1AvgScore.toFixed(2)}/100\n`;
    summaryMarkdown += `- **MCP 2 (Remote) Average Score**: ${mcp2AvgScore.toFixed(2)}/100\n\n`;

    // Summary table
    summaryMarkdown += `## Questions Summary\n\n`;
    summaryMarkdown += `| # | Library | Question | Winner | MCP1 Avg | MCP2 Avg |\n`;
    summaryMarkdown += `|---|---------|----------|--------|----------|----------|\n`;
    results.forEach((result, index) => {
      const mcp1Avg = (
        result.mcp1Scores.reduce((s, sc) => s + sc.score, 0) / result.mcp1Scores.length
      ).toFixed(1);
      const mcp2Avg = (
        result.mcp2Scores.reduce((s, sc) => s + sc.score, 0) / result.mcp2Scores.length
      ).toFixed(1);
      summaryMarkdown += `| ${index + 1} | ${result.library} | ${result.question.substring(0, 35)}... | MCP ${result.overallWinner} | ${mcp1Avg} | ${mcp2Avg} |\n`;
    });
    summaryMarkdown += `\n`;

    summaryMarkdown += `## Files Generated\n\n`;
    summaryMarkdown += `For each question, three files were generated:\n\n`;
    results.forEach((result, index) => {
      const questionNum = index + 1;
      summaryMarkdown += `### Question ${questionNum}: ${result.question.substring(0, 50)}...\n\n`;
      summaryMarkdown += `- [\`question_${questionNum}_mcp1_run.md\`](./question_${questionNum}_mcp1_run.md) - MCP 1 (Local) detailed results\n`;
      summaryMarkdown += `- [\`question_${questionNum}_mcp2_run.md\`](./question_${questionNum}_mcp2_run.md) - MCP 2 (Remote) detailed results\n`;
      summaryMarkdown += `- [\`question_${questionNum}_compare.md\`](./question_${questionNum}_compare.md) - Head-to-head comparison\n\n`;
    });

    // Write summary report
    writeFileSync(summaryPath, summaryMarkdown);
    const summaryDuration = Date.now() - summaryStartTime;
    console.log(`✅ Summary report generated in ${summaryDuration}ms`);
    console.log(`   Path: ${summaryPath}`);

    console.log();
    console.log("=".repeat(80));
    console.log("BENCHMARK COMPLETE");
    console.log("=".repeat(80));
    console.log(`Results folder: ${runFolder}`);
    console.log(`Total files generated: ${results.length * 3 + 1}`);
    console.log(`Total questions processed: ${results.length}/${questions.length}`);
    console.log(`MCP 1 wins: ${mcp1TotalWins}`);
    console.log(`MCP 2 wins: ${mcp2TotalWins}`);
    console.log(
      `Overall winner: ${mcp1TotalWins > mcp2TotalWins ? "MCP 1 (Local)" : "MCP 2 (Remote)"}`
    );
    console.log("=".repeat(80));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (mcpClient1) {
      await mcpClient1.close();
      console.log("\nDisconnected from Context7 MCP server (local)");
    }
    if (mcpClient2) {
      await mcpClient2.close();
      console.log("Disconnected from Context7 MCP server (remote)");
    }
  }
}

// Run benchmark with gpt-4o-mini
runBenchmark(MCP_MODEL);
