import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import open from "open";
import boxen from "boxen";
import {
  saveTokens,
  clearTokens,
  getValidAccessToken,
  startDeviceAuthorization,
  pollDeviceToken,
  DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
} from "../utils/auth.js";

import { trackEvent } from "../utils/tracking.js";
import { CLI_CLIENT_ID } from "../constants.js";
import { getBaseUrl } from "../utils/api.js";

let baseUrl = "https://context7.com";

export function setAuthBaseUrl(url: string): void {
  baseUrl = url;
}

export function registerAuthCommands(program: Command): void {
  program
    .command("login")
    .description("Log in to Context7")
    .option("--no-browser", "Don't open browser automatically")
    .action(async (options) => {
      await loginCommand(options);
    });

  program
    .command("logout")
    .description("Log out of Context7")
    .action(() => {
      logoutCommand();
    });

  program
    .command("whoami")
    .description("Show current login status")
    .action(async () => {
      await whoamiCommand();
    });
}

function renderDeviceCodeBox(
  userCode: string,
  verificationUri: string,
  verificationUriComplete: string | undefined
): string {
  const codeLine = `${pc.dim("Your one-time code:")}\n\n    ${pc.green(pc.bold(userCode))}`;
  // Per RFC 8628 §3.3, even when verification_uri_complete is available we
  // still show the bare verification_uri so users on screen readers / paper
  // can type it manually.
  const linkLine = verificationUriComplete
    ? `${pc.dim("Open this link to approve:")}\n${pc.cyan(verificationUriComplete)}\n\n${pc.dim("Or visit")} ${pc.cyan(verificationUri)} ${pc.dim("and enter the code above.")}`
    : `${pc.dim("Visit:")} ${pc.cyan(verificationUri)}`;
  return boxen(`${codeLine}\n\n${linkLine}`, {
    title: "Sign in to Context7",
    titleAlignment: "left",
    padding: 1,
    margin: { top: 1, bottom: 1, left: 2, right: 2 },
    borderStyle: "round",
    borderColor: "gray",
  });
}

/** Prints a prompt and resolves on the next keypress. No-op when stdin isn't a TTY. */
function waitForEnter(prompt: string): Promise<void> {
  if (!process.stdin.isTTY) return Promise.resolve();
  return new Promise<void>((resolve) => {
    process.stdout.write(`  ${pc.dim(prompt)} `);
    const onData = (chunk: Buffer) => {
      // Ctrl-C
      if (chunk[0] === 0x03) {
        process.stdin.removeListener("data", onData);
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write("\n");
        process.exit(130);
      }
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.write("\n");
      resolve();
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function announceIdentity(accessToken: string): Promise<string> {
  try {
    const whoami = await fetchWhoami(accessToken);
    const name = whoami.email || whoami.name;
    if (!name) return "Login successful!";
    const team = whoami.teamspace?.name;
    return team
      ? `Logged in as ${pc.bold(name)} ${pc.dim(`(${team})`)}`
      : `Logged in as ${pc.bold(name)}`;
  } catch {
    return "Login successful!";
  }
}

export async function performLogin(openBrowser = true): Promise<string | null> {
  const spinner = ora("Preparing login...").start();

  let authorization;
  try {
    authorization = await startDeviceAuthorization(baseUrl, CLI_CLIENT_ID);
  } catch (error) {
    spinner.fail(pc.red("Login failed"));
    if (error instanceof Error) console.error(pc.red(error.message));
    return null;
  }

  spinner.stop();

  console.log(
    renderDeviceCodeBox(
      authorization.user_code,
      authorization.verification_uri,
      authorization.verification_uri_complete
    )
  );

  const target = authorization.verification_uri_complete ?? authorization.verification_uri;
  if (openBrowser) {
    await waitForEnter("Press Enter to open the browser, or Ctrl-C to quit...");
    try {
      await open(target);
    } catch {
      console.log(pc.dim(`  Couldn't open a browser — visit the link above manually.`));
    }
  } else {
    console.log(pc.dim("  Open the link above in any browser to continue."));
    console.log("");
  }

  const waitingSpinner = ora({ text: "Waiting for authorization...", indent: 2 }).start();

  const deadline = Date.now() + authorization.expires_in * 1000;
  let intervalMs = (authorization.interval ?? DEFAULT_DEVICE_POLL_INTERVAL_SECONDS) * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const result = await pollDeviceToken(baseUrl, CLI_CLIENT_ID, authorization.device_code);
      if (result.status === "approved" && result.tokens) {
        saveTokens(result.tokens);
        const successText = await announceIdentity(result.tokens.access_token);
        waitingSpinner.succeed(pc.green(successText));
        return result.tokens.access_token;
      }
      if (result.status === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      if (result.status === "denied") {
        waitingSpinner.fail(pc.red("Authorization denied."));
        return null;
      }
      if (result.status === "expired") {
        waitingSpinner.fail(pc.red("Code expired. Run login again."));
        return null;
      }
      if (result.status === "transient") {
        // RFC 8628 §3.5: client MUST unilaterally reduce polling frequency on
        // connection timeout. Apply +5s like slow_down so a flaky network or
        // 5xx burst doesn't keep hitting at the original cadence.
        intervalMs += 5000;
        continue;
      }
      // pending — keep polling at the current cadence.
    } catch (error) {
      waitingSpinner.fail(pc.red("Login failed"));
      if (error instanceof Error) console.error(pc.red(error.message));
      return null;
    }
  }

  waitingSpinner.fail(pc.red("Code expired without approval."));
  return null;
}

async function loginCommand(options: { browser: boolean }): Promise<void> {
  trackEvent("command", { name: "login" });
  const existingToken = await getValidAccessToken();
  if (existingToken) {
    console.log(pc.yellow("You are already logged in."));
    console.log(pc.dim("Run 'ctx7 logout' first if you want to log in with a different account."));
    return;
  }
  clearTokens();

  const token = await performLogin(options.browser);
  if (!token) {
    process.exit(1);
  }
  console.log("");
  console.log(pc.dim("You can now use authenticated Context7 features."));
}

function logoutCommand(): void {
  trackEvent("command", { name: "logout" });
  if (clearTokens()) {
    console.log(pc.green("Logged out successfully."));
  } else {
    console.log(pc.yellow("You are not logged in."));
  }
}

async function whoamiCommand(): Promise<void> {
  trackEvent("command", { name: "whoami" });
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    console.log(pc.yellow("Not logged in."));
    console.log(pc.dim("Run 'ctx7 login' to authenticate."));
    return;
  }

  console.log(pc.green("Logged in"));

  try {
    const whoami = await fetchWhoami(accessToken);
    if (whoami.name) {
      console.log(`${pc.dim("Name:".padEnd(13))}${whoami.name}`);
    }
    if (whoami.email) {
      console.log(`${pc.dim("Email:".padEnd(13))}${whoami.email}`);
    }
    if (whoami.teamspace) {
      console.log(`${pc.dim("Teamspace:".padEnd(13))}${whoami.teamspace.name}`);
    }
  } catch {
    console.log(pc.dim("(Session may be expired - run 'ctx7 login' to refresh)"));
  }
}

interface WhoamiResponse {
  success: boolean;
  name: string | null;
  email: string | null;
  teamspace: { id: string; name: string } | null;
}

async function fetchWhoami(accessToken: string): Promise<WhoamiResponse> {
  const response = await fetch(`${getBaseUrl()}/api/dashboard/whoami`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch user info");
  }

  return (await response.json()) as WhoamiResponse;
}
