import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import open from "open";
import {
  generatePKCE,
  generateState,
  createCallbackServer,
  exchangeCodeForTokens,
  saveTokens,
  clearTokens,
  buildAuthorizationUrl,
  getValidAccessToken,
  shouldUseDeviceFlow,
  startDeviceAuthorization,
  pollDeviceToken,
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
    .option("--device", "Force device-code flow (use on SSH / headless hosts)")
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

export async function performDeviceLogin(openBrowser = true): Promise<string | null> {
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

  console.log("");
  console.log(pc.bold("Authorize the Context7 CLI in your browser:"));
  console.log("");
  console.log(`  Visit ${pc.cyan(authorization.verification_uri)}`);
  console.log(`  Enter code ${pc.green(pc.bold(authorization.user_code))}`);
  console.log("");

  if (openBrowser && authorization.verification_uri_complete) {
    try {
      await open(authorization.verification_uri_complete);
    } catch {
      // ignore; user can copy/paste
    }
  }

  const waitingSpinner = ora("Waiting for authorization...").start();

  const deadline = Date.now() + authorization.expires_in * 1000;
  let intervalMs = authorization.interval * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const result = await pollDeviceToken(
        baseUrl,
        CLI_CLIENT_ID,
        authorization.device_code
      );
      if (result.status === "approved" && result.tokens) {
        saveTokens(result.tokens);
        waitingSpinner.succeed(pc.green("Login successful!"));
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
      // pending or transient — keep polling.
    } catch (error) {
      waitingSpinner.fail(pc.red("Login failed"));
      if (error instanceof Error) console.error(pc.red(error.message));
      return null;
    }
  }

  waitingSpinner.fail(pc.red("Code expired without approval."));
  return null;
}

export async function performLogin(
  openBrowser = true,
  forceDevice = false
): Promise<string | null> {
  if (forceDevice || shouldUseDeviceFlow()) {
    return performDeviceLogin(openBrowser);
  }

  const spinner = ora("Preparing login...").start();

  try {
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();
    const callbackServer = createCallbackServer(state);
    const port = await callbackServer.port;
    const redirectUri = `http://localhost:${port}/callback`;
    const authUrl = buildAuthorizationUrl(
      baseUrl,
      CLI_CLIENT_ID,
      redirectUri,
      codeChallenge,
      state
    );

    spinner.stop();

    console.log("");
    console.log(pc.bold("Opening browser to log in..."));
    console.log("");

    if (openBrowser) {
      await open(authUrl);
      console.log(pc.dim("If the browser didn't open, visit this URL:"));
    } else {
      console.log(pc.dim("Open this URL in your browser:"));
    }
    console.log(pc.cyan(authUrl));
    console.log("");

    const waitingSpinner = ora("Waiting for login...").start();

    try {
      const { code } = await callbackServer.result;
      waitingSpinner.text = "Exchanging code for tokens...";

      const tokens = await exchangeCodeForTokens(
        baseUrl,
        code,
        codeVerifier,
        redirectUri,
        CLI_CLIENT_ID
      );
      saveTokens(tokens);
      callbackServer.close();

      waitingSpinner.succeed(pc.green("Login successful!"));
      return tokens.access_token;
    } catch (error) {
      callbackServer.close();
      waitingSpinner.fail(pc.red("Login failed"));
      if (error instanceof Error) {
        console.error(pc.red(error.message));
      }
      return null;
    }
  } catch (error) {
    spinner.fail(pc.red("Login failed"));
    if (error instanceof Error) {
      console.error(pc.red(error.message));
    }
    return null;
  }
}

async function loginCommand(options: { browser: boolean; device?: boolean }): Promise<void> {
  trackEvent("command", { name: "login" });
  const existingToken = await getValidAccessToken();
  if (existingToken) {
    console.log(pc.yellow("You are already logged in."));
    console.log(pc.dim("Run 'ctx7 logout' first if you want to log in with a different account."));
    return;
  }
  clearTokens();

  const token = await performLogin(options.browser, options.device ?? false);
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
