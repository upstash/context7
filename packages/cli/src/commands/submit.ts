import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import { submitLibrary } from "../utils/api.js";
import { getValidAccessToken } from "../utils/auth.js";
import { log } from "../utils/logger.js";
import { parseSubmitKind, resolveSubmitTarget } from "../utils/submit-library.js";
import { trackEvent } from "../utils/tracking.js";

const isTTY = process.stdout.isTTY;

const AUTH_MESSAGE =
  "Authentication required. Set CONTEXT7_API_KEY or run `ctx7 login` (API keys: https://context7.com/dashboard).";

interface SubmitCommandOptions {
  json?: boolean;
  type?: string;
  private?: boolean;
  gitToken?: string;
  skipVersionFiltering?: boolean;
  generateDocs?: boolean;
  websiteBaseUrl?: string;
}

function hasAuth(accessToken?: string): boolean {
  return Boolean(process.env.CONTEXT7_API_KEY || accessToken);
}

function writeJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function exitForStatus(status?: number): number {
  if (status === 401 || status === 403) return 2;
  if (status === 429) return 4;
  return 1;
}

async function submitCommand(url: string, options: SubmitCommandOptions): Promise<void> {
  trackEvent("command", { name: "submit" });

  const accessToken = await getValidAccessToken(
    options.json ? { recoverExpiredSession: false } : undefined
  );
  if (!hasAuth(accessToken)) {
    if (options.json) {
      writeJson({ error: "unauthorized", message: AUTH_MESSAGE });
    } else {
      log.error(AUTH_MESSAGE);
    }
    process.exitCode = 2;
    return;
  }

  let target;
  try {
    target = resolveSubmitTarget(url, parseSubmitKind(options.type), {
      private: options.private,
      gitToken: options.gitToken,
      skipVersionFiltering: options.skipVersionFiltering,
      generateDocs: options.generateDocs,
      websiteBaseUrl: options.websiteBaseUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      writeJson({ error: "validation_error", message });
    } else {
      log.error(message);
    }
    process.exitCode = 1;
    return;
  }

  const spinner = isTTY ? ora("Submitting documentation source to Context7...").start() : null;

  let result;
  try {
    result = await submitLibrary(target, accessToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner?.fail(message);
    if (!spinner) log.error(message);
    if (options.json) writeJson({ error: "request_failed", message });
    process.exitCode = 1;
    return;
  }

  if (result.error) {
    const message = result.message || result.error;
    if (result.status === 409) {
      spinner?.succeed(message);
      if (options.json) {
        writeJson({
          libraryName: result.libraryName,
          version: result.version,
          message,
          alreadyExists: true,
          status: 409,
          kind: target.kind,
        });
      } else if (!spinner) {
        log.warn(message);
      }
      return;
    }

    spinner?.fail(message);
    if (!spinner) log.error(message);
    if (options.json) {
      writeJson({ error: result.error, message, status: result.status });
    }
    process.exitCode = exitForStatus(result.status);
    return;
  }

  const message = result.message || "Documentation source submitted";
  spinner?.succeed(message);
  if (options.json) {
    writeJson({
      libraryName: result.libraryName,
      version: result.version,
      message,
      kind: target.kind,
      alreadyExists: false,
      status: result.status ?? 200,
    });
    return;
  }

  if (!spinner) log.success(message);
  if (result.libraryName) {
    log.plain(`  ${pc.cyan(result.libraryName)}`);
    log.dim(`  Query docs with: ctx7 docs ${result.libraryName} "<your question>"`);
  }
  log.blank();
}

export function registerSubmitCommand(program: Command): void {
  program
    .command("submit")
    .argument("<url>", "Documentation source URL to index on Context7")
    .option(
      "--type <kind>",
      "Source kind: github, gitlab, bitbucket, git, website, openapi, llmstxt (detected from the URL when omitted)"
    )
    .option("--private", "Mark a Git repository as private")
    .option("--git-token <token>", "Git access token for a private repository")
    .option("--skip-version-filtering", "Skip filtering version-specific documentation pages")
    .option("--generate-docs", "Generate docs from a private repository")
    .option(
      "--website-base-url <url>",
      "For a website, only index pages under this URL (the HTML documentation root)"
    )
    .option("--json", "Output as JSON")
    .description(
      "Submit a documentation source to the Context7 index. Does not install anything on this machine"
    )
    .action(async (url: string, options: SubmitCommandOptions) => {
      await submitCommand(url, options);
    });
}
