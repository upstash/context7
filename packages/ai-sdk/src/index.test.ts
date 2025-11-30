import { describe, test, expect } from "vitest";
import { generateText, stepCountIs } from "ai";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import {
  resolveLibrary,
  getLibraryDocs,
  context7Agent,
  SYSTEM_PROMPT,
  AGENT_PROMPT,
  RESOLVE_LIBRARY_PROMPT,
} from "./index";

const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
  apiKey: process.env.AWS_BEARER_TOKEN_BEDROCK,
});

describe("@upstash/context7-ai-sdk", () => {
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
        toolChoice: "required",
        stopWhen: stepCountIs(2),
        prompt: "Search for 'react' library",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("resolveLibrary");
      expect(result.toolResults.length).toBeGreaterThan(0);
    }, 30000);

    test("getLibraryDocs tool should fetch documentation", async () => {
      const result = await generateText({
        model: bedrock("anthropic.claude-3-haiku-20240307-v1:0"),
        tools: {
          getLibraryDocs: getLibraryDocs(),
        },
        toolChoice: "required",
        stopWhen: stepCountIs(2),
        prompt: "Fetch documentation for library ID '/facebook/react' with topic 'hooks'",
      });

      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.toolCalls[0].toolName).toBe("getLibraryDocs");
      expect(result.toolResults.length).toBeGreaterThan(0);
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

  describe("context7Agent factory", () => {
    test("should create an agent instance", () => {
      const agent = context7Agent();

      expect(agent).toBeDefined();
      expect(agent).toHaveProperty("generate");
    });

    test("should accept custom stopWhen condition", async () => {
      const { stepCountIs } = await import("ai");

      const agent = context7Agent({
        stopWhen: stepCountIs(3),
      });

      expect(agent).toBeDefined();
    });

    test("should accept custom system prompt", () => {
      const agent = context7Agent({
        system: "Custom system prompt for testing",
      });

      expect(agent).toBeDefined();
    });
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

    test("should export RESOLVE_LIBRARY_PROMPT", () => {
      expect(RESOLVE_LIBRARY_PROMPT).toBeDefined();
      expect(typeof RESOLVE_LIBRARY_PROMPT).toBe("string");
      expect(RESOLVE_LIBRARY_PROMPT).toContain("library");
    });
  });
});
