import {
  Experimental_Agent as Agent,
  type Experimental_AgentSettings as AgentSettings,
  type LanguageModel,
  stepCountIs,
} from "ai";
import { resolveLibrary, getLibraryDocs, type Context7ToolsConfig } from "@tools";
import { AGENT_PROMPT } from "@prompts";

/**
 * Configuration for Context7 agent
 */
export interface Context7AgentConfig
  extends Context7ToolsConfig,
    Partial<
      AgentSettings<{
        resolveLibrary: ReturnType<typeof resolveLibrary>;
        getLibraryDocs: ReturnType<typeof getLibraryDocs>;
      }>
    > {
  /**
   * Language model to use. Must be a LanguageModel instance from an AI SDK provider.
   * @example anthropic('claude-sonnet-4-20250514')
   * @example openai('gpt-4o')
   */
  model?: LanguageModel;
}

/**
 * Creates a Context7 documentation search agent
 *
 * The agent follows a multi-step workflow:
 * 1. Resolves library names to Context7 library IDs
 * 2. Fetches documentation for the resolved library
 * 3. Provides answers with code examples
 *
 * @param config Configuration options for the agent
 * @returns A configured AI agent with Context7 search capabilities
 *
 * @example
 * ```typescript
 * import { Context7Agent } from '@upstash/context7-ai-sdk';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const agent = Context7Agent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   apiKey: 'your-context7-api-key',
 * });
 *
 * const result = await agent.generate({
 *   prompt: 'How do I use React Server Components?',
 * });
 * ```
 */
export function Context7Agent(config: Context7AgentConfig = {}) {
  const {
    model,
    stopWhen = stepCountIs(5),
    system,
    apiKey,
    defaultMaxResults,
    ...agentSettings
  } = config;

  const context7Config: Context7ToolsConfig = { apiKey, defaultMaxResults };

  return new Agent({
    ...agentSettings,
    model: model as LanguageModel,
    system: system || AGENT_PROMPT,
    tools: {
      resolveLibrary: resolveLibrary(context7Config),
      getLibraryDocs: getLibraryDocs(context7Config),
    },
    stopWhen,
  });
}
