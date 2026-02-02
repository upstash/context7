import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import { resolveLibrary, getLibraryContext } from "../utils/api.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import { loadTokens } from "../utils/auth.js";
import type { LibrarySearchResult, ContextResponse } from "../types.js";

interface ResolveOptions {
  json?: boolean;
}

interface GetOptions {
  json?: boolean;
}

function getAccessToken(): string | undefined {
  const tokens = loadTokens();
  return tokens?.access_token;
}

function formatLibraryResult(lib: LibrarySearchResult, index: number): string {
  const lines: string[] = [];
  const indexStr = pc.dim(`${index + 1}.`);
  lines.push(`${indexStr} ${pc.bold(lib.title)} ${pc.cyan(lib.id)}`);

  if (lib.description) {
    lines.push(`   ${pc.dim(lib.description)}`);
  }

  const meta: string[] = [];
  if (lib.totalSnippets) {
    meta.push(`${lib.totalSnippets} snippets`);
  }
  if (lib.stars) {
    meta.push(`${lib.stars.toLocaleString()} stars`);
  }
  if (lib.trustScore !== undefined) {
    meta.push(`trust: ${lib.trustScore}/10`);
  }
  if (meta.length > 0) {
    lines.push(`   ${pc.dim(meta.join(" • "))}`);
  }

  if (lib.versions && lib.versions.length > 0) {
    const versionList = lib.versions.slice(0, 3).join(", ");
    const more = lib.versions.length > 3 ? ` (+${lib.versions.length - 3} more)` : "";
    lines.push(`   ${pc.dim(`versions: ${versionList}${more}`)}`);
  }

  return lines.join("\n");
}

export function registerDocsCommands(program: Command): void {
  const docs = program.command("docs").description("Query library documentation");

  docs
    .command("resolve")
    .alias("r")
    .argument("<library>", "Library name to search for (e.g., react, nextjs)")
    .argument("<query>", "Your question or task (used for relevance ranking)")
    .option("--json", "Output as JSON")
    .description("Resolve a library name to a Context7 library ID")
    .action(async (library: string, query: string, options: ResolveOptions) => {
      await resolveCommand(library, query, options);
    });

  docs
    .command("get")
    .alias("g")
    .argument("<libraryId>", "Context7 library ID (e.g., /facebook/react)")
    .argument("<query>", "Your question or task")
    .option("--json", "Output as JSON instead of text")
    .description("Get documentation context for a library")
    .action(async (libraryId: string, query: string, options: GetOptions) => {
      await getCommand(libraryId, query, options);
    });
}

export function registerDocsAliases(program: Command): void {
  program
    .command("resolve", { hidden: true })
    .argument("<library>", "Library name to search for")
    .argument("<query>", "Your question or task")
    .option("--json", "Output as JSON")
    .description("Resolve library name (alias for: docs resolve)")
    .action(async (library: string, query: string, options: ResolveOptions) => {
      await resolveCommand(library, query, options);
    });
}

async function resolveCommand(
  library: string,
  query: string,
  options: ResolveOptions
): Promise<void> {
  trackEvent("command", { name: "docs_resolve" });

  const spinner = ora(`Searching for "${library}"...`).start();

  const accessToken = getAccessToken();

  let data;
  try {
    data = await resolveLibrary(library, query, accessToken);
  } catch (err) {
    spinner.fail(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  if (data.error) {
    spinner.fail(pc.red(`Error: ${data.message || data.error}`));
    return;
  }

  if (!data.results || data.results.length === 0) {
    spinner.warn(pc.yellow(`No libraries found matching "${library}"`));
    return;
  }

  spinner.succeed(`Found ${data.results.length} library(ies)`);

  if (options.json) {
    console.log(JSON.stringify(data.results, null, 2));
    return;
  }

  log.blank();

  for (let i = 0; i < data.results.length; i++) {
    log.plain(formatLibraryResult(data.results[i], i));
    log.blank();
  }

  // Show quick command hint with the best match
  if (data.results.length > 0) {
    const bestMatch = data.results[0];
    log.plain(
      `${pc.bold("Quick command:")}\n` +
        `  Get docs: ${pc.cyan(`ctx7 docs get "${bestMatch.id}" "<your question>"`)}\n`
    );
  }
}

async function getCommand(libraryId: string, query: string, options: GetOptions): Promise<void> {
  trackEvent("command", { name: "docs_get" });

  // Validate library ID format
  if (!libraryId.startsWith("/")) {
    log.error(`Invalid library ID format: ${libraryId}`);
    log.info(`Library IDs should start with "/" (e.g., /facebook/react, /vercel/next.js)`);
    log.info(`Use "ctx7 docs resolve <library> <query>" to find the correct library ID`);
    log.blank();
    return;
  }

  const spinner = ora(`Fetching documentation for "${libraryId}"...`).start();

  const accessToken = getAccessToken();
  const outputType = options.json ? "json" : "txt";

  let result;
  try {
    result = await getLibraryContext(libraryId, query, { type: outputType }, accessToken);
  } catch (err) {
    spinner.fail(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  // Handle text response
  if (typeof result === "string") {
    spinner.succeed(`Documentation retrieved`);
    log.blank();
    console.log(result);
    return;
  }

  // Handle JSON response with potential errors
  const contextResponse = result as ContextResponse;

  if (contextResponse.error) {
    // Handle redirect
    if (contextResponse.redirectUrl) {
      spinner.warn(pc.yellow(`Library has been redirected`));
      log.blank();
      log.info(
        `The library ${libraryId} has been moved to: ${pc.cyan(contextResponse.redirectUrl)}`
      );
      log.info(`Use the new library ID to fetch documentation:`);
      log.plain(`  ${pc.cyan(`ctx7 docs get "${contextResponse.redirectUrl}" "${query}"`)}`);
      log.blank();
      return;
    }

    spinner.fail(pc.red(`Error: ${contextResponse.message || contextResponse.error}`));
    return;
  }

  const totalSnippets =
    (contextResponse.codeSnippets?.length || 0) + (contextResponse.infoSnippets?.length || 0);

  if (totalSnippets === 0) {
    spinner.warn(pc.yellow(`No documentation found for query: "${query}"`));
    return;
  }

  spinner.succeed(
    `Found ${contextResponse.codeSnippets?.length || 0} code snippet(s) and ${contextResponse.infoSnippets?.length || 0} info snippet(s)`
  );

  if (options.json) {
    console.log(JSON.stringify(contextResponse, null, 2));
    return;
  }

  // Format output for non-JSON mode (this case shouldn't normally happen since we request txt)
  log.blank();

  if (contextResponse.codeSnippets && contextResponse.codeSnippets.length > 0) {
    for (const snippet of contextResponse.codeSnippets) {
      log.plain(`${pc.bold(snippet.codeTitle)}`);
      if (snippet.codeDescription) {
        log.dim(snippet.codeDescription);
      }
      log.dim(`Source: ${snippet.codeId}`);
      log.blank();

      for (const code of snippet.codeList) {
        log.plain("```" + code.language);
        log.plain(code.code);
        log.plain("```");
        log.blank();
      }
    }
  }

  if (contextResponse.infoSnippets && contextResponse.infoSnippets.length > 0) {
    for (const snippet of contextResponse.infoSnippets) {
      if (snippet.breadcrumb) {
        log.plain(pc.bold(snippet.breadcrumb));
      }
      log.plain(snippet.content);
      if (snippet.pageId) {
        log.dim(`Source: ${snippet.pageId}`);
      }
      log.blank();
    }
  }
}
