import { describe, test, expect } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { z } from "zod";
import {
  resolveLibraryId,
  queryDocs,
  Context7Agent,
  SYSTEM_PROMPT,
  AGENT_PROMPT,
  RESOLVE_LIBRARY_ID_DESCRIPTION,
} from "./index";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
});

describe("@upstash/context7-tools-ai-sdk", () => {
  describe("Tool structure", () => {
    test("resolveLibraryId() should return a tool object with correct structure", () => {
      const tool = resolveLibraryId();

      expect(tool).toBeDefined();
      expect(tool).toHaveProperty("execute");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("description");
      expect(tool.description).toContain("library");
    });

    test("queryDocs() should return a tool object with correct structure", () => {
      const tool = queryDocs();

      expect(tool).toBeDefined();
      expect(tool).toHaveProperty("execute");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("description");
      expect(tool.description).toContain("documentation");
    });

    test("tools should accept custom config", () => {
      const resolveTool = resolveLibraryId({
        apiKey: "ctx7sk-test-key",
      });

      const docsTool = queryDocs({
        apiKey: "ctx7sk-test-key",
      });

      expect(resolveTool).toHaveProperty("execute");
      expect(docsTool).toHaveProperty("execute");
    });
  });

  describe("Tool usage with generateText", () => {
    test("resolveLibraryId tool should be called when searching for a library", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          resolveLibraryId: resolveLibraryId(),
        },
        toolChoice: { type: "tool", toolName: "resolveLibraryId" },
        stopWhen: stepCountIs(2),
        prompt: "Search for 'react' library",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("resolveLibraryId");
      expect(result.toolResults.length).toBeGreaterThan(0);
      const toolResult = result.toolResults[0] as unknown as { output: string };
      expect(typeof toolResult.output).toBe("string");
      expect(toolResult.output).toContain("Context7-compatible library ID");
    }, 30000);

    test("queryDocs tool should fetch documentation", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          queryDocs: queryDocs(),
        },
        toolChoice: { type: "tool", toolName: "queryDocs" },
        stopWhen: stepCountIs(2),
        prompt: "Fetch documentation for library ID '/facebook/react' about hooks",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("queryDocs");
      expect(result.toolResults.length).toBeGreaterThan(0);
      const toolResult = result.toolResults[0] as unknown as { output: string };
      expect(typeof toolResult.output).toBe("string");
      expect(toolResult.output.length).toBeGreaterThan(0);
    }, 30000);

    test("both tools can work together in a multi-step flow", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          resolveLibraryId: resolveLibraryId(),
          queryDocs: queryDocs(),
        },
        stopWhen: stepCountIs(5),
        prompt:
          "First use resolveLibraryId to find the Next.js library, then use queryDocs to get documentation about routing",
      });

      const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
      const toolNames = allToolCalls.map((call) => call.toolName);
      expect(toolNames).toContain("resolveLibraryId");
      expect(toolNames).toContain("queryDocs");
    }, 60000);
  });

  describe("Context7Agent class", () => {
    test("should create an agent instance with model", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
      });

      expect(agent).toBeDefined();
      expect(agent).toHaveProperty("generate");
      expect(agent).toHaveProperty("stream");
    });

    test("should accept custom stopWhen condition", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        stopWhen: stepCountIs(3),
      });

      expect(agent).toBeDefined();
    });

    test("should accept custom instructions", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        instructions: "Custom instructions for testing",
      });

      expect(agent).toBeDefined();
    });

    test("should accept Context7 config options", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        apiKey: "ctx7sk-test-key",
      });

      expect(agent).toBeDefined();
    });

    test("should accept additional tools alongside Context7 tools", () => {
      const customTool = tool({
        description: "A custom test tool",
        inputSchema: z.object({
          input: z.string().describe("Test input"),
        }),
        execute: async ({ input }) => ({ result: `processed: ${input}` }),
      });

      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          customTool,
        },
      });

      expect(agent).toBeDefined();
    });

    test("should generate response using agent workflow", async () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        stopWhen: stepCountIs(5),
      });

      const result = await agent.generate({
        prompt: "Find the React library and get documentation about hooks",
      });

      expect(result).toBeDefined();
      expect(result.steps.length).toBeGreaterThan(0);

      const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
      const toolNames = allToolCalls.map((call) => call.toolName);
      expect(toolNames).toContain("resolveLibraryId");
    }, 60000);

    test("should include Context7 tools in generate result", async () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        stopWhen: stepCountIs(5),
      });

      const result = await agent.generate({
        prompt:
          "Use resolveLibraryId to search for Next.js, then use queryDocs to get routing documentation",
      });

      expect(result).toBeDefined();

      const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
      const toolNames = allToolCalls.map((call) => call.toolName);

      expect(toolNames).toContain("resolveLibraryId");
      expect(toolNames).toContain("queryDocs");
    }, 60000);
  });

  describe("Prompt exports", () => {
    test("should export SYSTEM_PROMPT", () => {
      expect(SYSTEM_PROMPT).toBeDefined();
      expect(typeof SYSTEM_PROMPT).toBe("string");
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
    });

    test("should export AGENT_PROMPT", () => {
      expect(AGENT_PROMPT).toBeDefined();
      expect(typeof AGENT_PROMPT).toBe("string");
      expect(AGENT_PROMPT).toContain("Context7");
    });

    test("should export RESOLVE_LIBRARY_ID_DESCRIPTION", () => {
      expect(RESOLVE_LIBRARY_ID_DESCRIPTION).toBeDefined();
      expect(typeof RESOLVE_LIBRARY_ID_DESCRIPTION).toBe("string");
      expect(RESOLVE_LIBRARY_ID_DESCRIPTION).toContain("library");
    });
  });
});
