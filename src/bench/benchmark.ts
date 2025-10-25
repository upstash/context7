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
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("mcp benchmark is starting");

// Models that will evaluate the quality of responses
const JURY_MODELS: LanguageModel[] = [openai("gpt-5"), anthropic("claude-sonnet-4-5")];

const MCP_MODEL = openai("gpt-5-nano");

async function scoreResponse(
  question: string,
  context: string,
  model: LanguageModel
): Promise<{ score: number; explanation: string }> {
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
    return {
      score: parsed.score,
      explanation: parsed.explanation,
    };
  } catch (error) {
    console.error("Failed to parse score response:", error);
    return { score: 0, explanation: "Failed to parse response" };
  }
}

interface Question {
  library: string;
  question: string;
}

interface QuestionResult {
  library: string;
  question: string;
  context: string;
  scores: Array<{ model: string; score: number; explanation: string }>;
  averageScore: number;
  stepCount: number;
}

async function runBenchmark(mcpModel: LanguageModel) {
  let mcpClient;
  const results: QuestionResult[] = [];
  const mcpModelName = typeof mcpModel === "string" ? mcpModel : mcpModel.modelId;

  try {
    // Load questions
    const questionsFile = readFileSync(join(__dirname, "questions.json"), "utf-8");
    let { questions } = JSON.parse(questionsFile) as { questions: Question[] };

    questions = questions.slice(0, 100);

    console.log(`\nRunning benchmark with MCP model: ${mcpModelName}`);
    console.log(`Total questions: ${questions.length}\n`);

    // Initialize Context7 MCP client
    mcpClient = await createMCPClient({
      transport: new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
      }),
    });

    console.log("Connected to Context7 MCP server");

    // Get MCP tools
    const tools = await mcpClient.tools();

    // Process each question
    for (let i = 0; i < questions.length; i++) {
      const { library, question } = questions[i];
      console.log(`\n[${i + 1}/${questions.length}] Processing: ${library} - ${question}`);

      try {
        // Generate answer with MCP tools
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
        });

        const context = result.text;
        const stepCount = result.steps?.length || 0;
        console.log(`  Generated context (${context.length} chars, ${stepCount} steps)`);

        // Score with all jury models
        const scores = [];
        for (const juryModel of JURY_MODELS) {
          const juryModelName = typeof juryModel === "string" ? juryModel : juryModel.modelId;
          console.log(`  Scoring with ${juryModelName}...`);

          const scoreResult = await scoreResponse(question, context, juryModel);
          scores.push({
            model: juryModelName,
            score: scoreResult.score,
            explanation: scoreResult.explanation,
          });
        }

        // Calculate average score
        const averageScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
        console.log(`  Average score: ${averageScore.toFixed(2)}`);

        results.push({
          library,
          question,
          context,
          scores,
          averageScore,
          stepCount,
        });
      } catch (error) {
        console.error(`  Error processing question: ${error}`);
        results.push({
          library,
          question,
          context: "Error generating context",
          scores: [],
          averageScore: 0,
          stepCount: 0,
        });
      }
    }

    // Calculate overall average
    const overallAverage = results.reduce((sum, r) => sum + r.averageScore, 0) / results.length;
    const averageStepCount = results.reduce((sum, r) => sum + r.stepCount, 0) / results.length;

    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T");
    const dateTime = `${timestamp[0]}_${timestamp[1].split("Z")[0]}`;
    const reportPath = join(__dirname, "results", `run_${dateTime}.md`);

    // Create results directory if it doesn't exist
    mkdirSync(join(__dirname, "results"), { recursive: true });

    // Build markdown report
    let markdown = `# Context7 MCP Benchmark Results\n\n`;
    markdown += `## Specification\n\n`;
    markdown += `- **MCP Model**: ${mcpModelName}\n`;
    markdown += `- **Jury Models**: ${JURY_MODELS.map((m) => (typeof m === "string" ? m : m.modelId)).join(", ")}\n`;
    markdown += `- **Total Questions**: ${questions.length}\n`;
    markdown += `- **Date**: ${new Date().toISOString()}\n\n`;
    markdown += `## Overall Average Score: ${overallAverage.toFixed(2)}/100\n\n`;
    markdown += `## Average Step Count: ${averageStepCount.toFixed(2)}\n\n`;

    // Summary table
    markdown += `## Summary Table\n\n`;
    markdown += `| # | Library | Question | Average Score | Steps |\n`;
    markdown += `|---|---------|----------|---------------|-------|\n`;
    results.forEach((result, index) => {
      markdown += `| ${index + 1} | ${result.library} | ${result.question.substring(0, 50)}... | ${result.averageScore.toFixed(2)} | ${result.stepCount} |\n`;
    });
    markdown += `\n`;

    // Detailed results
    markdown += `## Detailed Results\n\n`;
    results.forEach((result, index) => {
      markdown += `### ${index + 1}. ${result.library}\n\n`;
      markdown += `**Question**: ${result.question}\n\n`;
      markdown += `**Average Score**: ${result.averageScore.toFixed(2)}/100\n\n`;
      markdown += `**Step Count**: ${result.stepCount}\n\n`;
      markdown += `#### Jury Scores:\n\n`;
      result.scores.forEach((score) => {
        markdown += `- **${score.model}**: ${score.score}/100\n`;
        markdown += `  - ${score.explanation}\n\n`;
      });
      markdown += `#### Context:\n\n`;
      markdown += `\`\`\`\n${result.context.substring(0, 1000)}${result.context.length > 1000 ? "..." : ""}\n\`\`\`\n\n`;
      markdown += `---\n\n`;
    });

    // Write report
    writeFileSync(reportPath, markdown);
    console.log(`\n\n✅ Benchmark complete! Report saved to: ${reportPath}`);
    console.log(`Overall average score: ${overallAverage.toFixed(2)}/100`);
    console.log(`Average step count: ${averageStepCount.toFixed(2)}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (mcpClient) {
      await mcpClient.close();
      console.log("\nDisconnected from Context7 MCP server");
    }
  }
}

// Run benchmark with gpt-4o-mini
runBenchmark(MCP_MODEL);
