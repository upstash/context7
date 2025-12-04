import { describe, test, expect } from "vitest";
import { generateText, stepCountIs, tool } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { z } from "zod";
import {
  resolveLibrary,
  getLibraryDocs,
  Context7Agent,
  SYSTEM_PROMPT,
  AGENT_PROMPT,
  RESOLVE_LIBRARY_DESCRIPTION,
} from "./index";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
});

describe("@upstash/context7-tools-ai-sdk", () => {
  describe("Tool structure", () => {
    test("resolveLibrary() should return a tool object with correct structure", () => {
      const tool = resolveLibrary();

      expect(tool).toBeDefined();
      expect(tool).toHaveProperty("execute");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("description");
      expect(tool.description).toContain("library");
    });

    test("getLibraryDocs() should return a tool object with correct structure", () => {
      const tool = getLibraryDocs();

      expect(tool).toBeDefined();
      expect(tool).toHaveProperty("execute");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("description");
      expect(tool.description).toContain("documentation");
    });

    test("tools should accept custom config", () => {
      const resolveTool = resolveLibrary({
        apiKey: "ctx7sk-test-key",
      });

      const docsTool = getLibraryDocs({
        apiKey: "ctx7sk-test-key",
        defaultMaxResults: 5,
      });

      expect(resolveTool).toHaveProperty("execute");
      expect(docsTool).toHaveProperty("execute");
    });
  });

  describe("Tool usage with generateText", () => {
    test("resolveLibrary tool should be called when searching for a library", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          resolveLibrary: resolveLibrary(),
        },
        toolChoice: { type: "tool", toolName: "resolveLibrary" },
        stopWhen: stepCountIs(2),
        prompt: "Search for 'react' library",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("resolveLibrary");
      expect(result.toolResults.length).toBeGreaterThan(0);
      const toolResult = result.toolResults[0] as unknown as { output: { success: boolean } };
      expect(toolResult.output.success).toBe(true);
    }, 30000);

    test("getLibraryDocs tool should fetch documentation", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          getLibraryDocs: getLibraryDocs(),
        },
        toolChoice: { type: "tool", toolName: "getLibraryDocs" },
        stopWhen: stepCountIs(2),
        prompt: "Fetch documentation for library ID '/facebook/react' with topic 'hooks'",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("getLibraryDocs");
      expect(result.toolResults.length).toBeGreaterThan(0);
      const toolResult = result.toolResults[0] as unknown as { output: { success: boolean } };
      expect(toolResult.output.success).toBe(true);
    }, 30000);

    test("both tools can work together in a multi-step flow", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          resolveLibrary: resolveLibrary(),
          getLibraryDocs: getLibraryDocs(),
        },
        stopWhen: stepCountIs(5),
        prompt:
          "First use resolveLibrary to find the Next.js library, then use getLibraryDocs to get documentation about routing",
      });

      const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
      const toolNames = allToolCalls.map((call) => call.toolName);
      expect(toolNames).toContain("resolveLibrary");
      expect(toolNames).toContain("getLibraryDocs");
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

    test("should accept custom system prompt", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        system: "Custom system prompt for testing",
      });

      expect(agent).toBeDefined();
    });

    test("should accept Context7 config options", () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        apiKey: "ctx7sk-test-key",
        defaultMaxResults: 5,
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
      expect(toolNames).toContain("resolveLibrary");
    }, 60000);

    test("should include Context7 tools in generate result", async () => {
      const agent = new Context7Agent({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        stopWhen: stepCountIs(5),
      });

      const result = await agent.generate({
        prompt:
          "Use resolveLibrary to search for Next.js, then use getLibraryDocs to get routing documentation",
      });

      expect(result).toBeDefined();

      const allToolCalls = result.steps.flatMap((step) => step.toolCalls);
      const toolNames = allToolCalls.map((call) => call.toolName);

      expect(toolNames).toContain("resolveLibrary");
      expect(toolNames).toContain("getLibraryDocs");
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

    test("should export RESOLVE_LIBRARY_DESCRIPTION", () => {
      expect(RESOLVE_LIBRARY_DESCRIPTION).toBeDefined();
      expect(typeof RESOLVE_LIBRARY_DESCRIPTION).toBe("string");
      expect(RESOLVE_LIBRARY_DESCRIPTION).toContain("library");
    });
  });
});
