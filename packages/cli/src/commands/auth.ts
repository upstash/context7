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
} from "../utils/auth.js";

// Default OAuth client ID for the CLI
// This should be registered in your OAuth provider (Clerk)
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
    .action(async () => {
      await logoutCommand();
    });

  program
    .command("whoami")
    .description("Show current login status")
    .action(async () => {
      await whoamiCommand();
    });
}

async function loginCommand(options: { browser: boolean }): Promise<void> {
  const existingTokens = loadTokens();
  if (existingTokens) {
    console.log(pc.yellow("You are already logged in."));
    console.log(pc.dim("Run 'ctx7 logout' first if you want to log in with a different account."));
    return;
  }

  const spinner = ora("Preparing login...").start();

  try {
    // Generate PKCE challenge and state
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();

    // Start local callback server
    const callbackServer = createCallbackServer(state);
    const port = await callbackServer.port;
    const redirectUri = `http://localhost:${port}/callback`;

    // Build authorization URL
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

    if (options.browser) {
      await open(authUrl);
      console.log(pc.dim("If the browser didn't open, visit this URL:"));
    } else {
      console.log(pc.dim("Open this URL in your browser:"));
    }
    console.log(pc.cyan(authUrl));
    console.log("");

    const waitingSpinner = ora("Waiting for login...").start();

    try {
      // Wait for the callback
      const { code } = await callbackServer.result;

      waitingSpinner.text = "Exchanging code for tokens...";

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(
        baseUrl,
        code,
        codeVerifier,
        redirectUri,
        CLI_CLIENT_ID
      );

      // Save tokens
      saveTokens(tokens);

      // Clean up the callback server
      callbackServer.close();

      waitingSpinner.succeed(pc.green("Login successful!"));
      console.log("");
      console.log(pc.dim("You can now use authenticated Context7 features."));
    } catch (error) {
      callbackServer.close();
      waitingSpinner.fail(pc.red("Login failed"));
      if (error instanceof Error) {
        console.error(pc.red(error.message));
      }
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(pc.red("Login failed"));
    if (error instanceof Error) {
      console.error(pc.red(error.message));
    }
    process.exit(1);
  }
}

async function logoutCommand(): Promise<void> {
  const cleared = clearTokens();

  if (cleared) {
    console.log(pc.green("Logged out successfully."));
  } else {
    console.log(pc.yellow("You are not logged in."));
  }
}

async function whoamiCommand(): Promise<void> {
  const tokens = loadTokens();

  if (!tokens) {
    console.log(pc.yellow("Not logged in."));
    console.log(pc.dim("Run 'ctx7 login' to authenticate."));
    return;
  }

  // Fetch user info from the userinfo endpoint
  try {
    const userInfo = await fetchUserInfo(tokens.access_token);

    console.log(pc.green("Logged in"));
    console.log("");

    if (userInfo.name) {
      console.log(`  ${pc.dim("Name:")}  ${userInfo.name}`);
    }
    if (userInfo.email) {
      console.log(`  ${pc.dim("Email:")} ${userInfo.email}`);
    }

    // Check expiration
    if (tokens.expires_at) {
      const expiresIn = tokens.expires_at - Date.now();
      if (expiresIn > 0) {
        const minutes = Math.floor(expiresIn / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
          console.log(`  ${pc.dim("Expires:")} in ${hours}h ${minutes % 60}m`);
        } else {
          console.log(`  ${pc.dim("Expires:")} in ${minutes}m`);
        }
      } else {
        console.log(`  ${pc.dim("Status:")} ${pc.yellow("Token expired")}`);
        if (tokens.refresh_token) {
          console.log(pc.dim("  Token will be refreshed on next API call."));
        }
      }
    }
  } catch {
    console.log(pc.green("Logged in"));

    // Show expiration even if we can't fetch user details
    if (tokens.expires_at) {
      const expiresIn = tokens.expires_at - Date.now();
      if (expiresIn > 0) {
        const minutes = Math.floor(expiresIn / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
          console.log(`  ${pc.dim("Expires:")} in ${hours}h ${minutes % 60}m`);
        } else {
          console.log(`  ${pc.dim("Expires:")} in ${minutes}m`);
        }
      }
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
  // Clerk's userinfo endpoint
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
