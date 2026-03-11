import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import { resolveLibrary, getLibraryContext } from "../utils/api.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import { loadTokens, isTokenExpired } from "../utils/auth.js";
import type { LibrarySearchResult, ContextResponse } from "../types.js";

const isTTY = process.stdout.isTTY;

function getReputationLabel(score: number | undefined): "High" | "Medium" | "Low" | "Unknown" {
  if (score === undefined || score < 0) return "Unknown";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

function getAccessToken(): string | undefined {
  const tokens = loadTokens();
  if (!tokens || isTokenExpired(tokens)) return undefined;
  return tokens.access_token;
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

  const spinner = isTTY ? ora(`Searching for "${library}"...`).start() : null;
  const accessToken = getAccessToken();

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
      "Your results only include libraries matching your access settings. To search across all public libraries, update your settings at https://context7.com/dashboard?tab=libraries"
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
  options: { json?: boolean }
): Promise<void> {
  trackEvent("command", { name: "docs" });

  if (!libraryId.startsWith("/") || !/^\/[^/]+\/[^/]/.test(libraryId)) {
    log.error(`Invalid library ID: "${libraryId}"`);
    log.info(`Expected format: /owner/repo or /owner/repo/version (e.g., /facebook/react)`);
    log.info(`Run "ctx7 library <name>" to find the correct ID`);
    process.exitCode = 1;
    return;
  }

  const spinner = isTTY ? ora(`Fetching docs for "${libraryId}"...`).start() : null;
  const accessToken = getAccessToken();
  const outputType = options.json ? "json" : "txt";

  let result;
  try {
    result = await getLibraryContext(libraryId, query, { type: outputType }, accessToken);
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

export function registerDocsCommands(program: Command): void {
  program
    .command("library")
    .argument("<name>", "Library name to search for")
    .argument("[query]", "Question or task for relevance ranking")
    .option("--json", "Output as JSON")
    .description("Resolve a library name to a Context7 library ID")
    .action(async (name: string, query: string | undefined, options: { json?: boolean }) => {
      await resolveCommand(name, query, options);
    });

  program
    .command("docs")
    .argument("<libraryId>", "Context7 library ID (e.g., /facebook/react)")
    .argument("<query>", "Question or task to get docs for")
    .option("--json", "Output as JSON")
    .description("Query documentation for a library")
    .action(async (libraryId: string, query: string, options: { json?: boolean }) => {
      await queryCommand(libraryId, query, options);
    });
}
