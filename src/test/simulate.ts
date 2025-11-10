import "dotenv/config";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * State object to hold simulation data
 * This prevents race conditions when running multiple simulations in parallel
 */
interface SimulationState {
  consoleLog: string;
  toolCallsMap: Map<string, { tool: string; args: any; response: any }>;
}

/**
 * Creates a logging function bound to a specific simulation state
 */
function createLogger(state: SimulationState) {
  return (message: string) => {
    console.log(message);
    state.consoleLog += message + "\n";
  };
}

/**
 * Simulates an LLM-powered conversation using Context7 MCP server
 *
 * Usage:
 * - CLI: npm run simulate "your question here"
 * - Programmatic: import { simulate } from './simulate.js'; await simulate("your question");
 */
export async function simulate(question?: string, uniqueId?: string) {
  // Create local state for this simulation (prevents race conditions)
  const state: SimulationState = {
    consoleLog: "",
    toolCallsMap: new Map(),
  };

  // Create logger bound to this simulation's state
  const log = createLogger(state);

  // If no question provided, try to get from command line args
  if (!question) {
    question = process.argv[2];
  }

  if (!question) {
    console.error("Error: Please provide a question as an argument");
    console.error('Usage: npm run simulate "your question here"');
    process.exit(1);
  }

  // Store original question for display
  const originalQuestion = question;

  // Append Context7 instruction to the question
  question = `${question}. Use Context7 to fetch docs.`;

  const startTime = new Date();

  log("=".repeat(80));
  log("Context7 MCP Simulation");
  log("=".repeat(80));
  log(`Question: ${originalQuestion}`);
  log(`Timestamp: ${startTime.toISOString()}`);
  log("");

  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;

  try {
    // Get API key from environment
    const apiKey = process.env.CONTEXT7_API_KEY;
    if (!apiKey) {
      throw new Error("CONTEXT7_API_KEY environment variable is required");
    }

    // Initialize MCP client using AI SDK's experimental_createMCPClient
    log("─".repeat(80));
    log("Initializing MCP Connection");
    log("─".repeat(80));

    mcpClient = await createMCPClient({
      transport: new StdioClientTransport({
        command: "node",
        args: ["dist/index.js", "--api-key", apiKey],
        env: {
          ...process.env,
          CONTEXT7_API_KEY: apiKey,
        },
      }),
    });
    log("✅ Connected to Context7 MCP server");
    log("");

    // Get AI SDK-compatible tools
    const tools = await mcpClient.tools();
    const toolNames = Object.keys(tools);
    log(`📦 Available tools: ${toolNames.join(", ")}`);
    log("");

    // Use AI model to interact with tools
    log("─".repeat(80));
    log("🤖 AI Processing");
    log("─".repeat(80));
    log("Model: Claude Haiku 4.5");
    log("");

    const model = anthropic("claude-haiku-4-5");

    const result = await generateText({
      model,
      tools,
      stopWhen: stepCountIs(15),
      messages: [
        {
          role: "user",
          content: question,
        },
      ],
      onStepFinish: (step) => {
        if (step.toolCalls) {
          step.toolCalls.forEach((tc) => {
            const input = (tc as any).input || (tc as any).args || {};
            log("─".repeat(80));
            log(`🔧 Tool Call: ${tc.toolName}`);
            log("─".repeat(80));
            log(`Arguments:`);
            log("```json");
            log(JSON.stringify(input, null, 2));
            log("```");
            log("");

            // Store for structured report using toolCallId as key
            state.toolCallsMap.set(tc.toolCallId, {
              tool: tc.toolName,
              args: input,
              response: null,
            });
          });
        }

        if (step.toolResults) {
          step.toolResults.forEach((tr) => {
            const resultText = JSON.stringify(tr, null, 2);
            log(`Result:`);
            log("```json");
            if (resultText.length > 2000) {
              log(resultText.substring(0, 2000));
              log(`... (truncated ${resultText.length - 2000} characters)`);
            } else {
              log(resultText);
            }
            log("```");
            log("");

            // Store response for structured report by matching toolCallId
            const toolCall = state.toolCallsMap.get(tr.toolCallId);
            if (toolCall) {
              toolCall.response = (tr as any).output || tr;
            }
          });
        }
      },
    });

    log("─".repeat(80));
    log("✅ AI Final Response");
    log("─".repeat(80));
    log(result.text);
    log("");

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    // Summary
    log("=".repeat(80));
    log("Summary");
    log("=".repeat(80));
    log(`✅ Simulation completed in ${(duration / 1000).toFixed(2)}s`);
    log(`⏱️  Start: ${startTime.toISOString()}`);
    log(`⏱️  End: ${endTime.toISOString()}`);
    log("=".repeat(80));

    // Create reports directory
    const reportsDir = join(dirname(dirname(__dirname)), "reports");
    mkdirSync(reportsDir, { recursive: true });

    // Generate filenames with timestamp and optional unique identifier
    const baseFilename = uniqueId
      ? `${startTime.toISOString().replace(/[:.]/g, "-").split("Z")[0]}_${uniqueId}`
      : startTime.toISOString().replace(/[:.]/g, "-").split("Z")[0];
    const reportPath = join(reportsDir, `${baseFilename}.md`);
    const rawReportPath = join(reportsDir, `${baseFilename}_raw.md`);

    // Convert Map to array for report generation (preserves insertion order)
    const structuredToolCalls = Array.from(state.toolCallsMap.values());

    // Generate structured markdown report
    let structuredReport = `# Context7 MCP Simulation Report\n\n`;
    structuredReport += `**Date**: ${startTime.toISOString()}\n`;
    structuredReport += `**Duration**: ${(duration / 1000).toFixed(2)}s\n\n`;
    structuredReport += `## Question\n\n${originalQuestion}\n\n`;

    // Add tool calls and responses
    if (structuredToolCalls.length > 0) {
      structuredReport += `## Tool Calls\n\n`;
      structuredToolCalls.forEach((call, idx) => {
        structuredReport += `### Tool Call ${idx + 1}: ${call.tool}\n\n`;
        structuredReport += `**Parameters:**\n\`\`\`json\n${JSON.stringify(call.args, null, 2)}\n\`\`\`\n\n`;
        structuredReport += `**Response:**\n\`\`\`json\n`;
        const responseText = JSON.stringify(call.response, null, 2);
        if (responseText.length > 3000) {
          structuredReport +=
            responseText.substring(0, 3000) +
            `...\n(truncated ${responseText.length - 3000} characters)\n`;
        } else {
          structuredReport += responseText + "\n";
        }
        structuredReport += `\`\`\`\n\n`;
      });
    }

    // Add final AI response
    structuredReport += `## AI Final Response\n\n${result.text}\n\n`;

    // Add console log section
    structuredReport += `---\n\n## Console Log\n\n\`\`\`\n${state.consoleLog}\n\`\`\`\n`;

    // Save structured markdown report
    writeFileSync(reportPath, structuredReport);

    // Generate raw markdown report (just question and raw text responses)
    let rawReport = `QUESTION: ${originalQuestion}\n\n`;
    rawReport += `${"─".repeat(80)}\n\n`;
    rawReport += `CONTEXT:\n\n`;

    // Add raw tool responses (extract text content only, skip resolve-library-id)
    structuredToolCalls.forEach((call) => {
      // Skip resolve-library-id tool responses
      if (call.tool === "resolve-library-id") {
        return;
      }

      if (call.response && call.response.content) {
        // Extract text from content array
        const content = call.response.content;
        if (Array.isArray(content)) {
          content.forEach((item: any) => {
            if (item.type === "text" && item.text) {
              rawReport += item.text + "\n\n";
            }
          });
        } else if (typeof content === "string") {
          rawReport += content + "\n\n";
        }
      }
    });

    // Save raw markdown report
    writeFileSync(rawReportPath, rawReport);

    log("");
    log(`📝 Structured report saved to: ${reportPath}`);
    log(`📝 Raw report saved to: ${rawReportPath}`);
  } catch (error) {
    const errorMsg = `❌ Simulation failed: ${error}`;
    log(errorMsg);
    process.exit(1);
  } finally {
    if (mcpClient) {
      await mcpClient.close();
    }
  }
}

// Run simulation if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  simulate().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
