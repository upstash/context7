import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";

import { addLibrary } from "../utils/api.js";
import { parseAddKind, resolveAddTarget } from "../utils/add-library.js";
import { log } from "../utils/logger.js";
import { trackEvent } from "../utils/tracking.js";
import { loadTokens, isTokenExpired } from "../utils/auth.js";

const isTTY = process.stdout.isTTY;

function getAccessToken(): string | undefined {
  const tokens = loadTokens();
  if (!tokens || isTokenExpired(tokens)) return undefined;
  return tokens.access_token;
}

function hasAuth(accessToken?: string): boolean {
  return Boolean(process.env.CONTEXT7_API_KEY || accessToken);
}

async function addCommand(
  url: string,
  options: {
    json?: boolean;
    type?: string;
    private?: boolean;
    gitToken?: string;
    skipVersionFiltering?: boolean;
    generateDocs?: boolean;
  }
): Promise<void> {
  trackEvent("command", { name: "add" });

  const accessToken = getAccessToken();
  if (!hasAuth(accessToken)) {
    const message =
      "Authentication required. Set CONTEXT7_API_KEY or run `ctx7 login` (API keys: https://context7.com/dashboard).";
    if (options.json) {
      console.log(JSON.stringify({ error: "unauthorized", message }, null, 2));
    } else {
      log.error(message);
    }
    process.exitCode = 2;
    return;
  }

  let target;
  try {
    target = resolveAddTarget(url, parseAddKind(options.type), {
      private: options.private,
      gitToken: options.gitToken,
      skipVersionFiltering: options.skipVersionFiltering,
      generateDocs: options.generateDocs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      console.log(JSON.stringify({ error: "validation_error", message }, null, 2));
    } else {
      log.error(message);
    }
    process.exitCode = 1;
    return;
  }

  const spinner = isTTY
    ? ora(`Submitting ${target.kind} source to Context7...`).start()
    : null;

  let result;
  try {
    result = await addLibrary(target, accessToken);
  } catch (err) {
    spinner?.fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (!spinner) log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  if (result.error) {
    const message = result.message || result.error;
    if (result.status === 401) {
      spinner?.fail(message);
      if (!spinner) log.error(message);
      if (options.json) {
        console.log(
          JSON.stringify(
            { error: result.error, message, status: result.status },
            null,
            2
          )
        );
      }
      process.exitCode = 2;
      return;
    }

    if (result.status === 409) {
      // Idempotent success for agents: source is already indexed / queued.
      spinner?.succeed(message);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              libraryName: result.libraryName,
              message,
              alreadyExists: true,
              status: 409,
              kind: target.kind,
            },
            null,
            2
          )
        );
      } else if (!spinner) {
        log.warn(message);
      }
      process.exitCode = 0;
      return;
    }

    spinner?.fail(message);
    if (!spinner) log.error(message);
    if (options.json) {
      console.log(
        JSON.stringify(
          { error: result.error, message, status: result.status },
          null,
          2
        )
      );
    }
    process.exitCode = 1;
    return;
  }

  spinner?.succeed(result.message || "Library submitted");
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          libraryName: result.libraryName,
          message: result.message,
          kind: target.kind,
          alreadyExists: false,
          status: result.status ?? 200,
        },
        null,
        2
      )
    );
    return;
  }

  if (!spinner) {
    log.success(result.message || "Library submitted");
  }
  if (result.libraryName) {
    log.plain(`  ${pc.cyan(result.libraryName)}`);
    log.dim(`  Query docs with: ctx7 docs ${result.libraryName} "<your question>"`);
  }
  log.blank();
}

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .alias("submit")
    .argument("<url>", "Git repo, docs site, OpenAPI, or llms.txt URL to submit")
    .option(
      "--type <kind>",
      "Source kind: github, gitlab, bitbucket, git, website, openapi, llmstxt (auto-detected when omitted)"
    )
    .option("--private", "Mark the repository as private")
    .option("--git-token <token>", "Git access token for private repositories")
    .option("--skip-version-filtering", "Skip filtering version-specific documentation pages")
    .option("--generate-docs", "Generate docs from source (private repos)")
    .option("--json", "Output as JSON")
    .description("Submit a library or docs source to Context7 for indexing")
    .action(
      async (
        url: string,
        options: {
          json?: boolean;
          type?: string;
          private?: boolean;
          gitToken?: string;
          skipVersionFiltering?: boolean;
          generateDocs?: boolean;
        }
      ) => {
        await addCommand(url, options);
      }
    );
}
