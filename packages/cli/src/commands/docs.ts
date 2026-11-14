import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import {
  resolveLibrary,
  getLibraryContext,
  getLibraryCode,
  getUpgradeGuide,
  hasSourceCode,
  CODE_LIMITS,
  CODE_OPERATIONS,
  type CodeOperation,
  type RetryableResult,
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
  if (hasSourceCode(lib)) {
    lines.push(`   ${pc.dim("Source code: searchable with ctx7 code")}`);
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

  if (options.json) {
    spinner?.stop();
    console.log(JSON.stringify(data.results || [], null, 2));
    return;
  }

  if (!data.results || data.results.length === 0) {
    spinner?.warn(`No libraries found matching "${library}"`);
    if (!spinner) log.warn(`No libraries found matching "${library}"`);
    return;
  }

  const results = data.results;

  spinner?.stop();

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

/**
 * Recovers a library ID that Git Bash rewrote on Windows and checks its format. Prints why it is
 * invalid and returns null, or returns the ID.
 */
function validateLibraryId(input: string, command: string): string | null {
  const libraryId = recoverLibraryId(input);
  if (/^\/[^/]+\/[^/]/.test(libraryId)) return libraryId;
  log.error(`Invalid library ID: "${libraryId}"`);
  log.notice(`Expected format: /owner/repo or /owner/repo/version (e.g., /reactjs/react.dev)`);
  log.notice(`Run "ctx7 library <name>" to find the correct ID`);
  if (process.platform === "win32") {
    log.notice(
      `On Git Bash, prefix the ID with an extra slash to avoid path conversion: ctx7 ${command} "//reactjs/react.dev" ...`
    );
  }
  process.exitCode = 1;
  return null;
}

async function queryCommand(
  libraryId: string,
  query: string,
  options: { json?: boolean; language?: string }
): Promise<void> {
  trackEvent("command", { name: "docs" });

  const validId = validateLibraryId(libraryId, "docs");
  if (!validId) return;
  libraryId = validId;

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
      log.notice(`New ID: ${pc.cyan(ctx.redirectUrl)}`);
      log.notice(`Run: ${pc.cyan(`ctx7 docs "${ctx.redirectUrl}" "${query}"`)}`);
      process.exitCode = 1;
      return;
    }

    spinner?.fail(ctx.message || ctx.error);
    if (!spinner) log.error(ctx.message || ctx.error);
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    spinner?.stop();
    console.log(JSON.stringify(ctx, null, 2));
    return;
  }

  const total = (ctx.codeSnippets?.length || 0) + (ctx.infoSnippets?.length || 0);
  if (total === 0) {
    spinner?.warn(`No documentation found for: "${query}"`);
    if (!spinner) log.warn(`No documentation found for: "${query}"`);
    return;
  }

  spinner?.stop();

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
  /** A git tag. `--version` is the CLI's own flag, so the tag has its own name. */
  tag?: string;
}

/**
 * Parses a numeric flag. By default it clamps the number into its range, like the MCP query-code
 * tool; with `reject`, a number that is not a whole number in the range is an error. Prints the
 * error and returns null for a bad value.
 */
function wholeNumber(
  value: string | undefined,
  name: string,
  limits: { min: number; max: number },
  mode: "clamp" | "reject" = "clamp"
): number | undefined | null {
  if (value === undefined) return undefined;
  const n = value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) {
    log.error(`${name} must be a number.`);
    process.exitCode = 1;
    return null;
  }
  if (mode === "reject") {
    if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
      const range =
        limits.max === Infinity ? `from ${limits.min}` : `from ${limits.min} to ${limits.max}`;
      log.error(`${name} must be a whole number ${range}.`);
      process.exitCode = 1;
      return null;
    }
    return n;
  }
  return Math.min(limits.max, Math.max(limits.min, Math.trunc(n)));
}

/**
 * Runs a request to an endpoint that can answer "come back later" and prints its answer. A pending
 * answer prints the server's message and the retry hint (or JSON with `pendingError`) and exits
 * with 75 (EX_TEMPFAIL); an error prints its message (or JSON) and exits with 1.
 */
async function runRetryable(
  spinnerText: string,
  request: () => Promise<RetryableResult>,
  options: {
    json?: boolean;
    /** The `error` value of a pending answer in JSON output. */
    pendingError: string;
    /** The hint after a pending answer's message, from its wait and its text. */
    retryHint: (retryAfter: number, message: string) => string;
    /** Printed as a warning (exit 1) when the answer is empty. Without it, the body is printed. */
    emptyMessage?: string;
  }
): Promise<void> {
  const spinner = isTTY ? ora(spinnerText).start() : null;
  let result: RetryableResult;
  try {
    result = await request();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner?.fail(`Error: ${message}`);
    if (!spinner) log.error(message);
    process.exitCode = 1;
    return;
  }
  spinner?.stop();

  if (result.kind === "pending") {
    if (options.json) {
      console.log(
        JSON.stringify({
          error: options.pendingError,
          message: result.message,
          retryAfter: result.retryAfter,
        })
      );
    } else {
      log.warn(result.message);
      log.notice(options.retryHint(result.retryAfter, result.message));
    }
    process.exitCode = 75; // EX_TEMPFAIL: try again later
    return;
  }
  if (result.kind === "error") {
    if (options.json)
      console.log(JSON.stringify({ error: result.error, message: result.message || result.error }));
    else log.error(result.message || result.error);
    process.exitCode = 1;
    return;
  }
  if (!result.body && options.emptyMessage) {
    log.warn(options.emptyMessage);
    process.exitCode = 1;
    return;
  }
  console.log(result.body);
}

async function codeCommand(
  libraryId: string,
  pattern: string | undefined,
  options: CodeCommandOptions
): Promise<void> {
  trackEvent("command", { name: "code" });
  const validId = validateLibraryId(libraryId, "code");
  if (!validId) return;
  libraryId = validId;
  const op = options.op;
  if (op && !CODE_OPERATIONS.includes(op as CodeOperation)) {
    log.error(`Invalid --op "${op}". Use one of: ${CODE_OPERATIONS.join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const context = wholeNumber(options.context, "--context", CODE_LIMITS.context);
  const headLimit = wholeNumber(options.headLimit, "--head-limit", CODE_LIMITS.headLimit);
  const offset = wholeNumber(options.offset, "--offset", CODE_LIMITS.offset);
  if (context === null || headLimit === null || offset === null) return;
  const accessToken = await getValidAccessToken();
  const target = options.tag ? `${libraryId} ${options.tag}` : libraryId;
  await runRetryable(
    `Searching the source of "${target}"...`,
    () =>
      getLibraryCode(
        libraryId,
        pattern,
        {
          version: options.tag,
          operation: op as CodeOperation | undefined,
          fixedStrings: options.fixedStrings,
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
      ),
    {
      json: options.json,
      pendingError: "indexing",
      // Newer servers already say how long to keep calling; then only map the
      // MCP tool names in that text to their CLI commands.
      retryHint: (seconds, message) =>
        /keep calling|up to \d+ minutes/i.test(message)
          ? `Run the same command again to call again. For docs meanwhile, use "ctx7 docs" (the CLI's query-docs).`
          : `Run the same command again in about ${seconds} seconds, and keep trying for up to 3 minutes: a first index usually takes 1 to 3. Meanwhile, use "ctx7 docs".`,
    }
  );
}

async function getUpgradeGuideCommand(
  libraryId: string,
  fromVersion: string,
  toVersion: string | undefined,
  options: { page?: string; json?: boolean }
): Promise<void> {
  trackEvent("command", { name: "get-upgrade-guide" });
  const validId = validateLibraryId(libraryId, "get-upgrade-guide");
  if (!validId) return;
  const page = wholeNumber(options.page, "--page", { min: 1, max: Infinity }, "reject");
  if (page === null) return;
  const accessToken = await getValidAccessToken();
  await runRetryable(
    `Fetching the upgrade guide for ${validId} ${fromVersion} -> ${toVersion ?? "latest"}...`,
    () =>
      getUpgradeGuide(validId, fromVersion, { toVersion, page, json: options.json }, accessToken),
    {
      json: options.json,
      pendingError: "preparing",
      retryHint: (seconds) => `Run the same command again in about ${seconds} seconds.`,
      emptyMessage: "No upgrade guide was returned for these versions.",
    }
  );
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
    .argument("<libraryId>", "Context7 library ID (e.g., /reactjs/react.dev)")
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
      "Context7 library ID of a Git repository, with an optional tag (e.g., /vercel/next.js or /colinhacks/zod/v3.24.2)"
    )
    .argument("[pattern]", "A regex to grep for, or a symbol for --op definition/references/read")
    .option("--op <operation>", `grep (default), definition, references, outline, read or list`)
    .option("-F, --fixed-strings", "Treat the pattern as plain text")
    .option("-i, --ignore-case", "Case-insensitive search")
    .option(
      "-g, --glob <glob>",
      "Only files matching a glob; start with ! to exclude. Repeat for more",
      (value: string, previous: string[] = []) => [...previous, value]
    )
    .option("-C, --context <n>", "Lines of context around each match (0 to 10)")
    .option("-l, --files-with-matches", "Print only the paths of matching files")
    .option("-c, --count", "Print the number of matches per file")
    .option(
      "--path <path>",
      "A folder or file of the library; for --op read, a file with #L10-L40; for --op definition, a library file that uses the symbol"
    )
    .option(
      "--head-limit <n>",
      "Maximum results, 1 to 500 (default: 20; definition 10, outline 50, list 100)"
    )
    .option("--offset <n>", "Skip this many results (0 to 10000)")
    .option("--json", "Output as JSON")
    .option(
      "--tag <tag>",
      "A git tag or commit of the library, e.g. v3.24.2 (default: the docs commit)"
    )
    .description("Search and read a library's source code at a version, like ripgrep")
    .action(async (libraryId: string, pattern: string | undefined, options: CodeCommandOptions) => {
      await codeCommand(libraryId, pattern, options);
    });

  program
    .command("get-upgrade-guide")
    .argument("<libraryId>", "Context7 library ID (e.g., /vercel/next.js)")
    .argument(
      "<fromVersion>",
      "The version the project uses now (e.g., 14.2.35 or 14); a bare major means the oldest release of that line"
    )
    .argument(
      "[toVersion]",
      "The version to upgrade to (e.g., 16); a bare major means the newest release of that line (default: the latest major)"
    )
    .option("--page <n>", "Page of a long guide, from 1 (default: 1); each page names the next")
    .option("--json", "Output as JSON")
    .description(
      "Get what changes between two versions of a library: breaking changes, codemods, deprecations and API changes"
    )
    .action(
      async (
        libraryId: string,
        fromVersion: string,
        toVersion: string | undefined,
        options: { page?: string; json?: boolean }
      ) => {
        await getUpgradeGuideCommand(libraryId, fromVersion, toVersion, options);
      }
    );
}
