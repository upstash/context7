import { describe, it } from "vitest";
import { anthropic } from "@ai-sdk/anthropic";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { resolve } from "path";
import {
  runEvals,
  printComparison,
  createSkillIntegration,
  createMCPIntegration,
} from "./index.js";
import type { PromptConfig } from "./types.js";

const CLAUDE_HAIKU = anthropic("claude-haiku-4-5-20251001");
const GPT = openrouter("openai/gpt-5.4");

const findDocsSkill = createSkillIntegration(
  "find-docs",
  resolve(__dirname, "../../../skills/find-docs/SKILL.md")
);

const context7MCP = createMCPIntegration();

const PROMPTS: PromptConfig[] = [
  // --- INVOKE: Direct how-to ---
  { prompt: "How do I use useEffect to fetch data in React?", expectInvoke: true },
  {
    prompt: "What is the Prisma syntax for defining a one-to-many relation with cascade delete?",
    expectInvoke: true,
  },

  // --- INVOKE: Code generation ---
  {
    prompt:
      "Write a Hono route handler that validates the request body with Zod and returns a typed JSON response",
    expectInvoke: true,
  },
  {
    prompt: "Write a React component that uses TanStack Query to fetch and display a list of users",
    expectInvoke: true,
  },

  // --- INVOKE: Debugging ---
  {
    prompt: "Why does my Supabase realtime subscription stop receiving events after a few minutes?",
    expectInvoke: true,
  },
  {
    prompt:
      "My Prisma query returns null even though the record exists in the database — what could be wrong?",
    expectInvoke: true,
  },

  // --- INVOKE: Code review / correctness ---
  {
    prompt:
      "Is using queryClient.invalidateQueries({ queryKey: ['user'] }) the correct way to refetch after a mutation in React Query v5?",
    expectInvoke: true,
  },

  // --- INVOKE: Version-specific ---
  {
    prompt:
      "What changed in Next.js 15 for the default fetch caching behavior compared to Next.js 14?",
    expectInvoke: true,
  },
  {
    prompt: "How do I use the new React 19 use() hook to read a Promise inside a component?",
    expectInvoke: true,
  },

  // --- INVOKE: Configuration ---
  {
    prompt:
      "How do I configure Prisma to use connection pooling with PgBouncer in a serverless environment?",
    expectInvoke: true,
  },

  // --- INVOKE: CLI commands ---
  {
    prompt:
      "What is the Prisma CLI command to reset the database and re-run all migrations and seed?",
    expectInvoke: true,
  },

  // --- INVOKE: Migration / upgrades ---
  {
    prompt:
      "I'm upgrading from React Query v4 to v5 — what breaking changes do I need to handle in useQuery calls?",
    expectInvoke: true,
  },
  {
    prompt:
      "What do I need to change when migrating from the Next.js Pages Router to the App Router for data fetching?",
    expectInvoke: true,
  },

  // --- INVOKE: Implicit library (inferred from code/imports) ---
  {
    prompt:
      "I'm using createClient from @supabase/supabase-js in my Next.js app — how do I access the session in a Server Component?",
    expectInvoke: true,
  },
  {
    prompt:
      "I have `import { drizzle } from 'drizzle-orm/neon-http'` — how do I run a transaction with this adapter?",
    expectInvoke: true,
  },

  // --- INVOKE: Multi-library integration ---
  {
    prompt:
      "How do I integrate tRPC with Next.js App Router so server components can call procedures without HTTP?",
    expectInvoke: true,
  },
  {
    prompt:
      "How do I combine Supabase auth with a tRPC context to validate the session on every protected procedure?",
    expectInvoke: true,
  },

  // --- NO INVOKE: Core language features ---
  { prompt: "Write a for loop in Python that prints numbers 1 to 10", expectInvoke: false },
  { prompt: "Explain what a closure is in JavaScript", expectInvoke: false },

  // --- NO INVOKE: CS concepts ---
  { prompt: "What is the time complexity of a binary search algorithm?", expectInvoke: false },
  { prompt: "What is memoization and when should I use it?", expectInvoke: false },

  // --- NO INVOKE: Math / logic ---
  { prompt: "What is 2 + 2?", expectInvoke: false },

  // --- NO INVOKE: Generic best practices (sounds adjacent but isn't) ---
  {
    prompt: "What is the difference between server-side rendering and static site generation?",
    expectInvoke: false,
  },
  {
    prompt: "Should I use a monorepo or separate repos for a frontend and backend project?",
    expectInvoke: false,
  },
];

describe("Context7 integration routing evals", { timeout: 600_000 }, () => {
  describe.skip("find-docs skill only", () => {
    it("routes doc questions to the skill and ignores off-topic prompts", async () => {
      const results = await runEvals({
        model: CLAUDE_HAIKU,
        integrations: [findDocsSkill],
        prompts: PROMPTS,
      });
      const passRate = results.filter((r) => r.pass).length / results.length;
      console.log(`Pass rate: ${Math.round(passRate * 100)}%`);
    });
  });

  describe.skip("MCP only", () => {
    it("calls resolveLibraryId/queryDocs for doc questions and skips for off-topic prompts", async () => {
      const results = await runEvals({
        model: CLAUDE_HAIKU,
        integrations: [context7MCP],
        prompts: PROMPTS,
      });
      const passRate = results.filter((r) => r.pass).length / results.length;
      console.log(`Pass rate: ${Math.round(passRate * 100)}%`);
    });
  });

  describe("comparison: skill vs MCP vs both", () => {
    it("shows which integration is invoked across all configurations and agents", async () => {
      const integrationSets = [
        { label: "skill-only", integrations: [findDocsSkill] },
        { label: "mcp-only", integrations: [context7MCP] },
        { label: "skill+mcp", integrations: [findDocsSkill, context7MCP] },
      ];

      const scenarios = await Promise.all(
        integrationSets.map(async ({ label, integrations }) => {
          const [claude, haiku, gpt] = await Promise.all([
            runEvals({ agent: "claude", integrations, prompts: PROMPTS }),
            runEvals({ agent: "aisdk", model: CLAUDE_HAIKU, integrations, prompts: PROMPTS }),
            runEvals({ agent: "aisdk", model: GPT, integrations, prompts: PROMPTS }),
          ]);

          return {
            label,
            runs: [
              { agent: "cc", results: claude },
              { agent: "haiku", results: haiku },
              { agent: "gpt-5.4", results: gpt },
            ],
          };
        })
      );

      printComparison(scenarios);
    });
  });
});
