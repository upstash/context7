import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import { addGitHubRepository } from "../utils/api.js";
import { getValidAccessToken } from "../utils/auth.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import type { AddLibraryRequest } from "../types.js";

const isTTY = process.stdout.isTTY;

/**
 * Normalize common GitHub repo inputs into a canonical HTTPS URL.
 * Accepts:
 *   - https://github.com/owner/repo(.git)
 *   - http://github.com/owner/repo
 *   - git@github.com:owner/repo(.git)
 *   - owner/repo
 *   - github.com/owner/repo
 */
export function normalizeGitHubRepoUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // git@github.com:owner/repo(.git)
  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
  }

  // owner/repo (no protocol/host)
  const shortMatch = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (shortMatch && !raw.includes("://") && !raw.includes("github.com")) {
    return `https://github.com/${shortMatch[1]}/${shortMatch[2]}`;
  }

  // http(s)://github.com/... or github.com/...
  let urlText = raw;
  if (/^github\.com\//i.test(urlText)) {
    urlText = `https://${urlText}`;
  }

  try {
    const url = new URL(urlText);
    if (!/^github\.com$/i.test(url.hostname)) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) {
      return null;
    }
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

export interface AddCommandOptions {
  json?: boolean;
  private?: boolean;
  gitToken?: string;
  skipVersionFiltering?: boolean;
  generateDocs?: boolean;
}

/**
 * Exit codes for scripting:
 *   0 — submitted successfully
 *   1 — validation / client / unexpected error
 *   2 — authentication required or invalid
 *   3 — duplicate repository (already indexed / already in team)
 *   4 — rate limited
 */
export function exitCodeForAddFailure(status: number, error: string): number {
  if (status === 401 || error === "unauthorized" || error === "invalid_api_key") {
    return 2;
  }
  if (status === 409 || error === "duplicate_repo") {
    return 3;
  }
  if (status === 429 || error === "rate_limit_exceeded") {
    return 4;
  }
  return 1;
}

async function addCommand(repoInput: string, options: AddCommandOptions): Promise<void> {
  trackEvent("command", { name: "add" });

  const docsRepoUrl = normalizeGitHubRepoUrl(repoInput);
  if (!docsRepoUrl) {
    const message =
      `Invalid GitHub repository: "${repoInput}". ` +
      `Expected https://github.com/owner/repo, git@github.com:owner/repo.git, or owner/repo.`;
    if (options.json) {
      console.log(JSON.stringify({ error: "validation_error", message, status: 400 }, null, 2));
    } else {
      log.error(message);
      log.info(`Examples: ${pc.cyan("ctx7 add vercel/next.js")}`);
      log.info(`          ${pc.cyan("ctx7 add https://github.com/vercel/next.js")}`);
    }
    process.exitCode = 1;
    return;
  }

  const accessToken = await getValidAccessToken();
  const request: AddLibraryRequest = { docsRepoUrl };
  if (options.private) request.private = true;
  if (options.gitToken) request.gitToken = options.gitToken;
  if (options.skipVersionFiltering) request.skipVersionFiltering = true;
  if (options.generateDocs) request.generateDocs = true;

  const spinner = isTTY && !options.json ? ora(`Submitting ${docsRepoUrl}...`).start() : null;

  let result;
  try {
    result = await addGitHubRepository(request, accessToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner?.fail(`Error: ${message}`);
    if (options.json) {
      console.log(JSON.stringify({ error: "request_failed", message, status: 0 }, null, 2));
    } else if (!spinner) {
      log.error(message);
    }
    process.exitCode = 1;
    return;
  }

  if (result.ok) {
    spinner?.succeed(result.message);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            libraryName: result.libraryName,
            message: result.message,
            docsRepoUrl,
            status: result.status,
          },
          null,
          2
        )
      );
    } else {
      if (!spinner) log.success(result.message);
      if (result.libraryName) {
        log.info(`Library ID: ${pc.cyan(result.libraryName)}`);
        log.info(`View: ${pc.cyan(`https://context7.com${result.libraryName}`)}`);
      }
      log.dim("Indexing can take a few minutes. Refresh later from the dashboard if needed.");
    }
    process.exitCode = 0;
    return;
  }

  const exitCode = exitCodeForAddFailure(result.status, result.error);
  spinner?.fail(result.message);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          error: result.error,
          message: result.message,
          status: result.status,
          docsRepoUrl,
        },
        null,
        2
      )
    );
  } else if (!spinner) {
    log.error(result.message);
  }

  if (!options.json) {
    if (exitCode === 2) {
      log.info(`Run ${pc.cyan("ctx7 login")} or set ${pc.cyan("CONTEXT7_API_KEY")}`);
    } else if (exitCode === 3) {
      log.info("This repository is already registered with Context7.");
    } else if (exitCode === 4) {
      log.info("Rate limit exceeded — try again later.");
    }
  }

  process.exitCode = exitCode;
}

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .argument("<repo>", "GitHub repository URL or owner/repo")
    .option("--json", "Output as JSON (stable fields for scripts/agents)")
    .option("--private", "Mark the repository as private")
    .option("--git-token <token>", "GitHub personal access token for private repos")
    .option("--skip-version-filtering", "Skip filtering version-specific documentation pages")
    .option("--generate-docs", "Generate docs from source (private repos)")
    .description("Submit a GitHub repository to Context7 for documentation indexing")
    .addHelpText(
      "after",
      `
Exit codes:
  0  submitted successfully
  1  validation or other client/server error
  2  authentication required or invalid API key
  3  duplicate repository
  4  rate limited

Examples:
  $ ctx7 add vercel/next.js
  $ ctx7 add https://github.com/vercel/next.js --json
  $ context7 add owner/repo --private --git-token ghp_xxx
`
    )
    .action(async (repo: string, options: AddCommandOptions) => {
      await addCommand(repo, options);
    });
}
