import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const mockGetValidAccessToken = vi.fn();
const mockClearTokens = vi.fn();
const mockSaveTokens = vi.fn();
const mockGeneratePKCE = vi.fn();
const mockGenerateState = vi.fn();
const mockCreateCallbackServer = vi.fn();
const mockExchangeCodeForTokens = vi.fn();
const mockBuildAuthorizationUrl = vi.fn();

vi.mock("../utils/auth.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
  clearTokens: (...args: unknown[]) => mockClearTokens(...args),
  saveTokens: (...args: unknown[]) => mockSaveTokens(...args),
  generatePKCE: (...args: unknown[]) => mockGeneratePKCE(...args),
  generateState: (...args: unknown[]) => mockGenerateState(...args),
  createCallbackServer: (...args: unknown[]) => mockCreateCallbackServer(...args),
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
}));

vi.mock("../utils/tracking.js", () => ({
  trackEvent: vi.fn(),
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  text: "",
};
vi.mock("ora", () => ({ default: () => mockSpinner }));

const mockOpen = vi.fn().mockResolvedValue(undefined);
vi.mock("open", () => ({ default: (...args: unknown[]) => mockOpen(...args) }));

vi.mock("../constants.js", () => ({ CLI_CLIENT_ID: "test-client-id" }));
vi.mock("../utils/api.js", () => ({ getBaseUrl: () => "https://test.context7.com" }));

import { registerAuthCommands, performLogin } from "../commands/auth.js";
import { trackEvent } from "../utils/tracking.js";

let logOutput: string[];
let errorOutput: string[];
let originalExit: typeof process.exit;

beforeEach(() => {
  vi.clearAllMocks();
  logOutput = [];
  errorOutput = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logOutput.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorOutput.push(args.join(" "));
  });
  originalExit = process.exit;
  process.exit = vi.fn() as never;

  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch not mocked");
    })
  );
});

afterEach(() => {
  process.exit = originalExit;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function runCommand(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on commander errors
  registerAuthCommands(program);
  await program.parseAsync(["node", "test", ...args]);
}

describe("login command", () => {
  test("skips login when valid token exists", async () => {
    mockGetValidAccessToken.mockResolvedValue("existing-token");
    await runCommand("login");
    expect(logOutput.some((l) => l.includes("already logged in"))).toBe(true);
  });

  test("tracks login event", async () => {
    mockGetValidAccessToken.mockResolvedValue("existing-token");
    await runCommand("login");
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "login" });
  });

  test("calls process.exit(1) when login fails", async () => {
    mockGetValidAccessToken.mockResolvedValue(null);
    mockClearTokens.mockReturnValue(false);
    // Mock performLogin to fail by making createCallbackServer reject
    mockGeneratePKCE.mockReturnValue({ codeVerifier: "v", codeChallenge: "c" });
    mockGenerateState.mockReturnValue("state");
    mockCreateCallbackServer.mockReturnValue({
      port: Promise.resolve(52417),
      result: Promise.reject(new Error("timeout")),
      close: vi.fn(),
    });
    mockBuildAuthorizationUrl.mockReturnValue("https://example.com/auth");

    await runCommand("login").catch(() => {});
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("logout command", () => {
  test("logs success when tokens were cleared", async () => {
    mockClearTokens.mockReturnValue(true);
    await runCommand("logout");
    expect(logOutput.some((l) => l.includes("Logged out successfully"))).toBe(true);
  });

  test("logs 'not logged in' when no tokens existed", async () => {
    mockClearTokens.mockReturnValue(false);
    await runCommand("logout");
    expect(logOutput.some((l) => l.includes("You are not logged in"))).toBe(true);
  });

  test("tracks logout event", async () => {
    mockClearTokens.mockReturnValue(false);
    await runCommand("logout");
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "logout" });
  });
});

describe("whoami command", () => {
  test("shows 'Not logged in' when no valid token", async () => {
    mockGetValidAccessToken.mockResolvedValue(null);
    await runCommand("whoami");
    expect(logOutput.some((l) => l.includes("Not logged in"))).toBe(true);
  });

  test("fetches and displays user info when logged in", async () => {
    mockGetValidAccessToken.mockResolvedValue("valid-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            name: "Test User",
            email: "test@example.com",
            teamspace: null,
          }),
      })
    );

    await runCommand("whoami");
    expect(logOutput.some((l) => l.includes("Logged in"))).toBe(true);
    expect(logOutput.some((l) => l.includes("Test User"))).toBe(true);
    expect(logOutput.some((l) => l.includes("test@example.com"))).toBe(true);
  });

  test("shows session expired hint when fetch fails", async () => {
    mockGetValidAccessToken.mockResolvedValue("valid-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.reject(new Error("fail")),
      })
    );

    await runCommand("whoami");
    expect(logOutput.some((l) => l.includes("Session may be expired"))).toBe(true);
  });

  test("tracks whoami event", async () => {
    mockGetValidAccessToken.mockResolvedValue(null);
    await runCommand("whoami");
    expect(trackEvent).toHaveBeenCalledWith("command", { name: "whoami" });
  });
});

describe("performLogin", () => {
  test("returns access_token on success", async () => {
    const mockClose = vi.fn();
    mockGeneratePKCE.mockReturnValue({ codeVerifier: "verifier", codeChallenge: "challenge" });
    mockGenerateState.mockReturnValue("state");
    mockCreateCallbackServer.mockReturnValue({
      port: Promise.resolve(52417),
      result: Promise.resolve({ code: "auth-code", state: "state" }),
      close: mockClose,
    });
    mockBuildAuthorizationUrl.mockReturnValue("https://example.com/auth");
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token: "new-token",
      token_type: "bearer",
    });

    const result = await performLogin();
    expect(result).toBe("new-token");
    expect(mockSaveTokens).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  test("opens browser by default", async () => {
    mockGeneratePKCE.mockReturnValue({ codeVerifier: "v", codeChallenge: "c" });
    mockGenerateState.mockReturnValue("s");
    mockCreateCallbackServer.mockReturnValue({
      port: Promise.resolve(52417),
      result: Promise.resolve({ code: "code", state: "s" }),
      close: vi.fn(),
    });
    mockBuildAuthorizationUrl.mockReturnValue("https://example.com/auth");
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token: "tok",
      token_type: "bearer",
    });

    await performLogin(true);
    expect(mockOpen).toHaveBeenCalledWith("https://example.com/auth");
  });

  test("skips browser open when openBrowser=false", async () => {
    mockGeneratePKCE.mockReturnValue({ codeVerifier: "v", codeChallenge: "c" });
    mockGenerateState.mockReturnValue("s");
    mockCreateCallbackServer.mockReturnValue({
      port: Promise.resolve(52417),
      result: Promise.resolve({ code: "code", state: "s" }),
      close: vi.fn(),
    });
    mockBuildAuthorizationUrl.mockReturnValue("https://example.com/auth");
    mockExchangeCodeForTokens.mockResolvedValue({
      access_token: "tok",
      token_type: "bearer",
    });

    await performLogin(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test("returns null on callback failure", async () => {
    const mockClose = vi.fn();
    mockGeneratePKCE.mockReturnValue({ codeVerifier: "v", codeChallenge: "c" });
    mockGenerateState.mockReturnValue("s");
    mockCreateCallbackServer.mockReturnValue({
      port: Promise.resolve(52417),
      result: Promise.reject(new Error("User cancelled")),
      close: mockClose,
    });
    mockBuildAuthorizationUrl.mockReturnValue("https://example.com/auth");

    const result = await performLogin();
    expect(result).toBeNull();
    expect(mockClose).toHaveBeenCalled();
  });
});
