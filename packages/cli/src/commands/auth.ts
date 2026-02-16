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
  loadTokens,
  clearTokens,
  buildAuthorizationUrl,
  isTokenExpired,
} from "../utils/auth.js";

import { trackEvent } from "../utils/tracking.js";

const CLI_CLIENT_ID = "2veBSofhicRBguUT";

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
  const existingTokens = loadTokens();
  if (existingTokens) {
    const expired = isTokenExpired(existingTokens);
    if (!expired || existingTokens.refresh_token) {
      console.log(pc.yellow("You are already logged in."));
      console.log(
        pc.dim("Run 'ctx7 logout' first if you want to log in with a different account.")
      );
      return;
    }
    clearTokens();
  }

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
  const tokens = loadTokens();

  if (!tokens) {
    console.log(pc.yellow("Not logged in."));
    console.log(pc.dim("Run 'ctx7 login' to authenticate."));
    return;
  }

  console.log(pc.green("Logged in"));

  try {
    const userInfo = await fetchUserInfo(tokens.access_token);
    if (userInfo.name) {
      console.log(`${pc.dim("Name:".padEnd(9))}${userInfo.name}`);
    }
    if (userInfo.email) {
      console.log(`${pc.dim("Email:".padEnd(9))}${userInfo.email}`);
    }
  } catch {
    if (isTokenExpired(tokens) && !tokens.refresh_token) {
      console.log(pc.dim("(Session may be expired - run 'ctx7 login' to refresh)"));
    }
  }
}

interface UserInfo {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch("https://clerk.context7.com/oauth/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch user info");
  }

  return (await response.json()) as UserInfo;
}
