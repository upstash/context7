import { ToolLoopAgent, type ToolLoopAgentSettings, type ToolSet, stepCountIs } from "ai";
import { resolveLibraryId, queryDocs } from "@tools";
import { AGENT_PROMPT } from "@prompts";

/**
 * Configuration for Context7 agent.
 */
export interface Context7AgentConfig extends ToolLoopAgentSettings<never, ToolSet> {
  /**
   * Context7 API key. If not provided, uses the CONTEXT7_API_KEY environment variable.
   */
  apiKey?: string;
}

/**
 * Context7 documentation search agent
 *
 * The agent follows a multi-step workflow:
 * 1. Resolves library names to Context7 library IDs
 * 2. Fetches documentation for the resolved library
 * 3. Provides answers with code examples
 *
 * @example
 * ```typescript
 * import { Context7Agent } from '@upstash/context7-tools-ai-sdk';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const agent = new Context7Agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   apiKey: 'your-context7-api-key',
 * });
 *
 * const result = await agent.generate({
 *   prompt: 'How do I use React Server Components?',
 * });
 * ```
 */
export class Context7Agent extends ToolLoopAgent<never, ToolSet> {
  constructor(config: Context7AgentConfig) {
    const {
      model,
      stopWhen = stepCountIs(5),
      instructions,
      apiKey,

      tools,
      ...agentSettings
    } = config;

    const context7Config = { apiKey };

    super({
      ...agentSettings,
      model,
      instructions: instructions || AGENT_PROMPT,
      tools: {
        ...tools,
        resolveLibraryId: resolveLibraryId(context7Config),
        queryDocs: queryDocs(context7Config),
      },
      stopWhen,
    });
  }
}
