import {
  Experimental_Agent as Agent,
  type Experimental_AgentSettings as AgentSettings,
  type ToolSet,
  stepCountIs,
} from "ai";
import { resolveLibrary, getLibraryDocs } from "@tools";
import { AGENT_PROMPT } from "@prompts";

/**
 * Configuration for Context7 agent.
 */
export interface Context7AgentConfig extends AgentSettings<ToolSet> {
  /**
   * Context7 API key. If not provided, uses the CONTEXT7_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * Default maximum number of documentation results per request.
   * @default 10
   */
  defaultMaxResults?: number;
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
export class Context7Agent extends Agent<ToolSet> {
  constructor(config: Context7AgentConfig) {
    const {
      model,
      stopWhen = stepCountIs(5),
      system,
      apiKey,
      defaultMaxResults,
      tools,
      ...agentSettings
    } = config;

    const context7Config = { apiKey, defaultMaxResults };

    super({
      ...agentSettings,
      model,
      system: system || AGENT_PROMPT,
      tools: {
        ...tools,
        resolveLibrary: resolveLibrary(context7Config),
        getLibraryDocs: getLibraryDocs(context7Config),
      },
      stopWhen,
    });
  }
}
