import { Command } from "commander";
import ora from "ora";

import { searchDocumentation } from "../utils/api.js";
import { getValidAccessToken } from "../utils/auth.js";
import { recoverLibraryId } from "../utils/library-id.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";

const isTTY = process.stdout.isTTY;

interface SearchCommandOptions {
  library: string[];
  version?: string;
  language?: string;
  json?: boolean;
}

function collectLibrary(value: string, libraries: string[]): string[] {
  return [...libraries, value];
}

async function searchCommand(query: string, options: SearchCommandOptions): Promise<void> {
  trackEvent("command", { name: "search" });

  if (options.library.length > 4) {
    log.error("Search accepts at most four library hints");
    process.exitCode = 1;
    return;
  }
  if (options.version && options.library.length === 0) {
    log.error("--version requires at least one --library hint");
    process.exitCode = 1;
    return;
  }

  const spinner = isTTY ? ora("Searching documentation...").start() : null;
  const accessToken = await getValidAccessToken();
  const libraries = options.library.map(recoverLibraryId);

  let result;
  try {
    result = await searchDocumentation(
      query,
      {
        libraries: libraries.length ? libraries : undefined,
        version: options.version,
        language: options.language,
        type: options.json ? "json" : "txt",
      },
      accessToken
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner?.fail(`Error: ${message}`);
    if (!spinner) log.error(message);
    process.exitCode = 1;
    return;
  }

  if (typeof result === "string") {
    spinner?.stop();
    console.log(result);
    return;
  }

  if ("error" in result) {
    const message = result.message || result.error;
    spinner?.fail(message);
    if (!spinner) log.error(message);
    process.exitCode = 1;
    return;
  }

  spinner?.stop();
  console.log(JSON.stringify(result, null, 2));
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .argument("<query>", "Question or task to search for")
    .option(
      "-l, --library <library>",
      "Prefer a library name or Context7 ID. Repeat up to four times",
      collectLibrary,
      []
    )
    .option("--version <version>", "Prefer a library version")
    .option("--language <language>", "Prefer snippets in a programming language")
    .option("--json", "Output as JSON")
    .description("Search documentation without resolving a library first")
    .action(async (query: string, options: SearchCommandOptions) => {
      await searchCommand(query, options);
    });
}
