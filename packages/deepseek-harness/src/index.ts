import type { Context } from "@deepseek-ai/cordis";
import type { PromptSection } from "@deepseek-ai/dsh-system-prompt";
import { defineTool } from "@deepseek-ai/dsh-tools";
import Schema from "@deepseek-ai/schemastery";
import { fetchLibraryContext, searchLibraries } from "./api.js";
import { formatSearchResults } from "./format.js";

export const name = "context7";
export const inject = ["tools", "systemPrompt"];

export interface Config {
  apiKey?: string;
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string(),
});

const RESOLVE_DESCRIPTION = `Resolves a package or product name to a Context7-compatible library ID and returns matching libraries.

Call this tool before query-docs unless the user explicitly provides a library ID in /org/project or /org/project/version format. Select the closest official match using name, source reputation, snippet coverage, benchmark score, and version.`;

const QUERY_DESCRIPTION = `Retrieves current documentation and code examples from Context7 for a library.

Call resolve-library-id first unless the user explicitly provides a library ID in /org/project or /org/project/version format. Use a specific query scoped to one concept and do not include secrets, credentials, personal data, or proprietary code.`;

const API_TIMEOUT_MS = 60_000;

const CONTEXT7_PROMPT: PromptSection = {
  name: "context7:tool-guidance",
  order: 120,
  text: `Use Context7 to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service, even well-known ones. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use it even when you think you know the answer because training data may not reflect recent changes. Prefer Context7 over web search for library documentation.

Do not use Context7 for refactoring, writing scripts from scratch, debugging business logic, code review, repository-local code, or general programming concepts.

Workflow:
1. Call resolve-library-id with the official library name and the user's specific goal unless the user provides a Context7 library ID in /org/project or /org/project/version format.
2. Select the best match using exact name match, description relevance, snippet coverage, source reputation, benchmark score, and requested version. Prefer official sources.
3. Call query-docs with the selected library ID and a specific query scoped to one concept. Split distinct concepts into separate calls with the same library ID unless the question is about how they interact.
4. Answer using the fetched documentation.

Do not call either tool more than three times per question. Never include secrets, credentials, personal data, or proprietary code in a query.`,
};

export function apply(ctx: Context, config: Config = {}): void {
  const apiKey = config.apiKey || process.env.CONTEXT7_API_KEY;

  ctx.systemPrompt.section(CONTEXT7_PROMPT);

  ctx.tools.register(
    defineTool({
      name: "resolve-library-id",
      description: RESOLVE_DESCRIPTION,
      parameters: {
        query: {
          type: "string",
          required: true,
          description:
            "What to look up in the library documentation. Include the user's goal so Context7 can rank results by relevance.",
        },
        libraryName: {
          type: "string",
          required: true,
          description:
            "Official library or product name with its normal spelling and punctuation, such as Next.js, Customer.io, or Three.js.",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      timeoutMs: API_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const response = await searchLibraries(args.query, args.libraryName, apiKey, exec.signal);
        if (response.results.length === 0 && response.error) throw new Error(response.error);
        return formatSearchResults(response);
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "query-docs",
      description: QUERY_DESCRIPTION,
      parameters: {
        libraryId: {
          type: "string",
          required: true,
          description:
            "Exact Context7-compatible library ID returned by resolve-library-id, such as /vercel/next.js or /vercel/next.js/v15.1.8.",
        },
        query: {
          type: "string",
          required: true,
          description:
            "Specific documentation question scoped to one concept. Include relevant API names and versions.",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      timeoutMs: API_TIMEOUT_MS,
      isConcurrencySafe: () => true,
      execute: (args, exec) => fetchLibraryContext(args.query, args.libraryId, apiKey, exec.signal),
    })
  );
}
