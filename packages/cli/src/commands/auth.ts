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

export async function performLogin(openBrowser = true): Promise<string | null> {
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
