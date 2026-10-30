import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import {
  resolveLibrary,
  getLibraryContext,
  getLibraryCode,
  CODE_OPERATIONS,
  type CodeOperation,
} from "../utils/api.js";
import { recoverLibraryId } from "../utils/library-id.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import { getValidAccessToken } from "../utils/auth.js";
import type { LibrarySearchResult, ContextResponse } from "../types.js";

const isTTY = process.stdout.isTTY;

function getReputationLabel(score: number | undefined): "High" | "Medium" | "Low" | "Unknown" {
  if (score === undefined || score < 0) return "Unknown";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function formatLibraryResult(lib: LibrarySearchResult, index: number): string {
  const lines: string[] = [];
  lines.push(`${pc.dim(`${index + 1}.`)} ${pc.bold(`Title: ${lib.title}`)}`);
  lines.push(`   ${pc.cyan(`Context7-compatible library ID: ${lib.id}`)}`);

  if (lib.description) {
    lines.push(`   ${pc.dim(`Description: ${lib.description}`)}`);
  }

  if (lib.totalSnippets) {
    lines.push(`   ${pc.dim(`Code Snippets: ${lib.totalSnippets}`)}`);
  }
  if (lib.trustScore !== undefined) {
    lines.push(`   ${pc.dim(`Source Reputation: ${getReputationLabel(lib.trustScore)}`)}`);
  }
  if (lib.benchmarkScore !== undefined && lib.benchmarkScore > 0) {
    lines.push(`   ${pc.dim(`Benchmark Score: ${lib.benchmarkScore}`)}`);
  }
  if (lib.versions && lib.versions.length > 0) {
    lines.push(`   ${pc.dim(`Versions: ${lib.versions.join(", ")}`)}`);
  }

  return lines.join("\n");
}

async function resolveCommand(
  library: string,
  query: string | undefined,
  options: { json?: boolean }
): Promise<void> {
  trackEvent("command", { name: "library" });

  // Resolve the token before the spinner starts: an expired session may prompt.
  const accessToken = await getValidAccessToken();
  const spinner = isTTY ? ora(`Searching for "${library}"...`).start() : null;

  let data;
  try {
    data = await resolveLibrary(library, query, accessToken);
  } catch (err) {
    spinner?.fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (!spinner) log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (data.error) {
    spinner?.fail(data.message || data.error);
    if (!spinner) log.error(data.message || data.error);
    process.exitCode = 1;
    return;
  }

  if (!data.results || data.results.length === 0) {
    spinner?.warn(`No libraries found matching "${library}"`);
    if (!spinner) log.warn(`No libraries found matching "${library}"`);
    return;
  }

  const results = data.results;

  spinner?.stop();

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  log.blank();

  if (data.searchFilterApplied) {
    log.warn(
      "Your results only include libraries matching your teamspace's library filters. To adjust quality thresholds or blocked libraries, update your filters at https://context7.com/dashboard?tab=policies"
    );
    log.blank();
  }

  for (let i = 0; i < results.length; i++) {
    log.plain(formatLibraryResult(results[i], i));
    log.blank();
  }

  if (isTTY && results.length > 0) {
    const best = results[0];
    log.plain(
      `${pc.bold("Quick command:")}\n` + `  ${pc.cyan(`ctx7 docs "${best.id}" "<your question>"`)}`
    );
    log.blank();
  }
}

async function queryCommand(
  libraryId: string,
  query: string,
  options: { json?: boolean; language?: string }
): Promise<void> {
  trackEvent("command", { name: "docs" });

  // Git Bash on Windows rewrites "/owner/repo" into a Windows path; recover it.
  libraryId = recoverLibraryId(libraryId);

  if (!libraryId.startsWith("/") || !/^\/[^/]+\/[^/]/.test(libraryId)) {
    log.error(`Invalid library ID: "${libraryId}"`);
    log.info(`Expected format: /owner/repo or /owner/repo/version (e.g., /facebook/react)`);
    log.info(`Run "ctx7 library <name>" to find the correct ID`);
    if (process.platform === "win32") {
      log.info(
        `On Git Bash, prefix the ID with an extra slash to avoid path conversion: ctx7 docs "//facebook/react" "<your question>"`
      );
    }
    process.exitCode = 1;
    return;
  }

  // Resolve the token before the spinner starts: an expired session may prompt.
  const accessToken = await getValidAccessToken();
  const spinner = isTTY ? ora(`Fetching docs for "${libraryId}"...`).start() : null;
  const outputType = options.json ? "json" : "txt";

  let result;
  try {
    result = await getLibraryContext(
      libraryId,
      query,
      { type: outputType, language: options.language },
      accessToken
    );
  } catch (err) {
    spinner?.fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (!spinner) log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (typeof result === "string") {
    spinner?.stop();
    console.log(result);
    return;
  }

  const ctx = result as ContextResponse;

  if (ctx.error) {
    if (ctx.redirectUrl) {
      spinner?.warn("Library has been redirected");
      if (!spinner) log.warn("Library has been redirected");
      log.info(`New ID: ${pc.cyan(ctx.redirectUrl)}`);
      log.info(`Run: ${pc.cyan(`ctx7 docs "${ctx.redirectUrl}" "${query}"`)}`);
      process.exitCode = 1;
      return;
    }

    spinner?.fail(ctx.message || ctx.error);
    if (!spinner) log.error(ctx.message || ctx.error);
    process.exitCode = 1;
    return;
  }

  const total = (ctx.codeSnippets?.length || 0) + (ctx.infoSnippets?.length || 0);
  if (total === 0) {
    spinner?.warn(`No documentation found for: "${query}"`);
    if (!spinner) log.warn(`No documentation found for: "${query}"`);
    return;
  }

  spinner?.stop();

  if (options.json) {
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  log.blank();

  if (ctx.codeSnippets) {
    for (const snippet of ctx.codeSnippets) {
      log.plain(pc.bold(snippet.codeTitle));
      if (snippet.codeDescription) log.dim(snippet.codeDescription);
      log.blank();
      for (const code of snippet.codeList) {
        log.plain("```" + code.language);
        log.plain(code.code);
        log.plain("```");
        log.blank();
      }
    }
  }

  if (ctx.infoSnippets) {
    for (const snippet of ctx.infoSnippets) {
      if (snippet.breadcrumb) log.plain(pc.bold(snippet.breadcrumb));
      log.plain(snippet.content);
      log.blank();
    }
  }
}

interface CodeCommandOptions {
  op?: string;
  fixedStrings?: boolean;
  ignoreCase?: boolean;
  glob?: string[];
  context?: string;
  filesWithMatches?: boolean;
  count?: boolean;
  path?: string;
  headLimit?: string;
  offset?: string;
  json?: boolean;
  // The first version's flags.
  type?: string;
  limit?: string;
  version?: string;
}

const LEGACY_TYPES: Record<string, { op: CodeOperation; fixedStrings?: boolean }> = {
  text: { op: "grep", fixedStrings: true },
  source: { op: "read" },
  definition: { op: "definition" },
  references: { op: "references" },
  outline: { op: "outline" },
};

function wholeNumber(
  value: string | undefined,
  name: string,
  max: number
): number | undefined | null {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    log.error(`${name} must be a whole number from 0 to ${max}.`);
    process.exitCode = 1;
    return null;
  }
  return n;
}

async function codeCommand(
  libraryId: string,
  pattern: string | undefined,
  options: CodeCommandOptions
): Promise<void> {
  trackEvent("command", { name: "code" });
  libraryId = recoverLibraryId(libraryId);
  if (!/^\/[^/]+\/[^/]/.test(libraryId)) {
    log.error(`Invalid library ID: "${libraryId}"`);
    log.info(
      `Expected format: /owner/repo or /owner/repo/version. Run "ctx7 library <name>" to find it.`
    );
    process.exitCode = 1;
    return;
  }
  const legacy = options.type ? LEGACY_TYPES[options.type] : undefined;
  if (options.type && !legacy) {
    log.error(
      `Invalid --type "${options.type}". Use --op with one of: ${CODE_OPERATIONS.join(", ")}.`
    );
    process.exitCode = 1;
    return;
  }
  const op = options.op ?? legacy?.op;
  if (op && !CODE_OPERATIONS.includes(op as CodeOperation)) {
    log.error(`Invalid --op "${op}". Use one of: ${CODE_OPERATIONS.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const context = wholeNumber(options.context, "--context", 10);
  const headLimit = wholeNumber(options.headLimit ?? options.limit, "--head-limit", 500);
  const offset = wholeNumber(options.offset, "--offset", 10_000);
  if (context === null || headLimit === null || offset === null) return;
  if (options.version && libraryId.split("/").filter(Boolean).length === 2)
    libraryId = `${libraryId}/${options.version}`;

  const accessToken = await getValidAccessToken();
  const spinner = isTTY ? ora(`Searching the source of "${libraryId}"...`).start() : null;
  let result;
  try {
    result = await getLibraryCode(
      libraryId,
      pattern,
      {
        operation: op as CodeOperation | undefined,
        fixedStrings: options.fixedStrings || legacy?.fixedStrings,
        ignoreCase: options.ignoreCase,
        glob: options.glob,
        path: options.path,
        context,
        outputMode: options.count
          ? "count"
          : options.filesWithMatches
            ? "files_with_matches"
            : undefined,
        headLimit: headLimit || undefined,
        offset: offset || undefined,
        json: options.json,
      },
      accessToken
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner?.fail(`Error: ${message}`);
    if (!spinner) log.error(message);
    process.exitCode = 1;
    return;
  }
  spinner?.stop();

  if (result.kind === "indexing") {
    log.warn(result.message);
    log.info(`Run the same command again in about ${result.retryAfter} seconds.`);
    process.exitCode = 75; // EX_TEMPFAIL: try again later
    return;
  }
  if (result.kind === "error") {
    log.error(result.message || result.error);
    process.exitCode = 1;
    return;
  }
  console.log(result.body);
}

export function registerDocsCommands(program: Command): void {
  program
    .command("library")
    .argument("<name>", "Library name to search for")
    .argument("[query]", "What to look up in the library's documentation")
    .option("--json", "Output as JSON")
    .description("Resolve a library name to a Context7 library ID")
    .action(async (name: string, query: string | undefined, options: { json?: boolean }) => {
      await resolveCommand(name, query, options);
    });

  program
    .command("docs")
    .argument("<libraryId>", "Context7 library ID (e.g., /facebook/react)")
    .argument(
      "<query>",
      "Single-topic question to get docs for (run a separate query per distinct concept, unless asking how they interact)"
    )
    .option("--json", "Output as JSON")
    .option(
      "--language <name>",
      "Programming language you write in (e.g., Python, Go); ranks code examples in that language first"
    )
    .description("Query documentation for a library")
    .action(
      async (libraryId: string, query: string, options: { json?: boolean; language?: string }) => {
        await queryCommand(libraryId, query, options);
      }
    );

  program
    .command("code")
    .argument(
      "<libraryId>",
      "Context7 library ID (e.g., /vercel/next.js or /vercel/next.js/v15.5.0)"
    )
    .argument(
      "[pattern]",
      "A regex to grep for, a question for --op search, or a symbol for --op definition/references/read"
    )
    .option(
      "--op <operation>",
      `grep (default), search, definition, references, outline, read or list`
    )
    .option("-F, --fixed-strings", "Treat the pattern as plain text")
    .option("-i, --ignore-case", "Case-insensitive search")
    .option("-g, --glob <glob...>", "Only files matching a glob; start with ! to exclude")
    .option("-C, --context <n>", "Lines of context around each match (0 to 10)")
    .option("-l, --files-with-matches", "Print only the paths of matching files")
    .option("-c, --count", "Print the number of matches per file")
    .option("--path <path>", "A folder or file; for --op read, a file with #L10-L40")
    .option("--head-limit <n>", "Maximum results (default: 20)")
    .option("--offset <n>", "Skip this many results")
    .option("--json", "Output as JSON")
    .option("--type <type>", "Deprecated: use --op")
    .option("--limit <n>", "Deprecated: use --head-limit")
    .option("--version <version>", "Deprecated: add the version to the library ID")
    .description("Search and read a library's source code at a version, like ripgrep")
    .action(async (libraryId: string, pattern: string | undefined, options: CodeCommandOptions) => {
      await codeCommand(libraryId, pattern, options);
    });
}
