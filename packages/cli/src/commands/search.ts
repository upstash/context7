import { Command } from "commander";
import ora from "ora";

import { searchDocumentation } from "../utils/api.js";
import { getValidAccessToken } from "../utils/auth.js";
import { recoverLibraryId } from "../utils/library-id.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";

const isTTY = process.stdout.isTTY;

interface SearchCommandOptions {
  library?: string[];
  libraryVersion?: string;
  language?: string;
  json?: boolean;
}

async function searchCommand(query: string, options: SearchCommandOptions): Promise<void> {
  trackEvent("command", { name: "search" });

  // Resolve the token before the spinner starts: an expired session may prompt.
  const accessToken = await getValidAccessToken();
  const spinner = isTTY ? ora("Searching documentation...").start() : null;

  let result;
  try {
    result = await searchDocumentation(
      query,
      {
        type: options.json ? "json" : "txt",
        // Git Bash on Windows rewrites "/owner/repo" into a Windows path; recover it.
        libraries: options.library?.map(recoverLibraryId),
        version: options.libraryVersion,
        language: options.language,
      },
      accessToken
    );
  } catch (err) {
    spinner?.fail(err instanceof Error ? err.message : String(err));
    if (!spinner) log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  spinner?.stop();
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .argument("<query>", "Question or task to search documentation for")
    .option(
      "--library <name>",
      "Library name or Context7 library ID to search (e.g., Next.js, /vercel/next.js); repeat for up to four libraries",
      (name: string, names: string[] = []) => [...names, name]
    )
    .option("--library-version <version>", "Library version to search (e.g., 15.4.0)")
    .option(
      "--language <name>",
      "Programming language you write in (e.g., Python, Go); prefers results in that language"
    )
    .option("--json", "Output as JSON")
    .description("Search documentation across all libraries in one step")
    .action(async (query: string, options: SearchCommandOptions) => {
      await searchCommand(query, options);
    });
}
