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
const mockShouldUseDeviceFlow = vi.fn((..._args: unknown[]) => false);
const mockStartDeviceAuthorization = vi.fn();
const mockPollDeviceToken = vi.fn();

vi.mock("../utils/auth.js", () => ({
  getValidAccessToken: (...args: unknown[]) => mockGetValidAccessToken(...args),
  clearTokens: (...args: unknown[]) => mockClearTokens(...args),
  saveTokens: (...args: unknown[]) => mockSaveTokens(...args),
  generatePKCE: (...args: unknown[]) => mockGeneratePKCE(...args),
  generateState: (...args: unknown[]) => mockGenerateState(...args),
  createCallbackServer: (...args: unknown[]) => mockCreateCallbackServer(...args),
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args),
  buildAuthorizationUrl: (...args: unknown[]) => mockBuildAuthorizationUrl(...args),
  shouldUseDeviceFlow: (...args: unknown[]) => mockShouldUseDeviceFlow(...args),
  startDeviceAuthorization: (...args: unknown[]) => mockStartDeviceAuthorization(...args),
  pollDeviceToken: (...args: unknown[]) => mockPollDeviceToken(...args),
  DEFAULT_DEVICE_POLL_INTERVAL_SECONDS: 5,
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

import { registerAuthCommands, performLogin, performDeviceLogin } from "../commands/auth.js";
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

  test("uses device flow when forceDevice=true", async () => {
    mockStartDeviceAuthorization.mockResolvedValue({
      device_code: "dc",
      user_code: "ABCD-EFGH",
      verification_uri: "https://t/oauth/device",
      verification_uri_complete: "https://t/oauth/device?user_code=ABCD-EFGH",
      expires_in: 600,
      interval: 0,
    });
    mockPollDeviceToken.mockResolvedValue({
      status: "approved",
      tokens: { access_token: "ctx7sk-x", token_type: "bearer" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
    );

    const result = await performLogin(false, true);
    expect(result).toBe("ctx7sk-x");
    expect(mockCreateCallbackServer).not.toHaveBeenCalled();
  });

  test("uses device flow when shouldUseDeviceFlow returns true", async () => {
    mockShouldUseDeviceFlow.mockReturnValueOnce(true);
    mockStartDeviceAuthorization.mockResolvedValue({
      device_code: "dc",
      user_code: "X",
      verification_uri: "https://t",
      verification_uri_complete: undefined,
      expires_in: 600,
      interval: 0,
    });
    mockPollDeviceToken.mockResolvedValue({
      status: "approved",
      tokens: { access_token: "tok", token_type: "bearer" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
    );

    const result = await performLogin(false);
    expect(result).toBe("tok");
    expect(mockStartDeviceAuthorization).toHaveBeenCalled();
  });
});

describe("performDeviceLogin", () => {
  const authorization = {
    device_code: "dc",
    user_code: "ABCD-EFGH",
    verification_uri: "https://t.example/oauth/device",
    verification_uri_complete: "https://t.example/oauth/device?user_code=ABCD-EFGH",
    expires_in: 600,
    interval: 0, // 0ms poll cadence so tests don't need fake timers
  };

  beforeEach(() => {
    // Quiet whoami so announceIdentity falls back without polluting stdout.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })
    );
  });

  test("returns access_token on approved", async () => {
    mockStartDeviceAuthorization.mockResolvedValue(authorization);
    mockPollDeviceToken.mockResolvedValue({
      status: "approved",
      tokens: { access_token: "ctx7sk-x", token_type: "bearer" },
    });

    const result = await performDeviceLogin(false);
    expect(result).toBe("ctx7sk-x");
    expect(mockSaveTokens).toHaveBeenCalledWith({
      access_token: "ctx7sk-x",
      token_type: "bearer",
    });
  });

  test("returns null on denied", async () => {
    mockStartDeviceAuthorization.mockResolvedValue(authorization);
    mockPollDeviceToken.mockResolvedValue({ status: "denied" });

    expect(await performDeviceLogin(false)).toBeNull();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  test("returns null on expired", async () => {
    mockStartDeviceAuthorization.mockResolvedValue(authorization);
    mockPollDeviceToken.mockResolvedValue({ status: "expired" });

    expect(await performDeviceLogin(false)).toBeNull();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });

  test("keeps polling on transient errors", async () => {
    mockStartDeviceAuthorization.mockResolvedValue(authorization);
    mockPollDeviceToken
      .mockResolvedValueOnce({ status: "transient", errorMessage: "ECONN" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "approved",
        tokens: { access_token: "t", token_type: "bearer" },
      });

    const result = await performDeviceLogin(false);
    expect(result).toBe("t");
    expect(mockPollDeviceToken).toHaveBeenCalledTimes(3);
  });

  test("backs off polling cadence when slow_down is returned", async () => {
    vi.useFakeTimers();
    try {
      mockStartDeviceAuthorization.mockResolvedValue(authorization);
      mockPollDeviceToken.mockResolvedValueOnce({ status: "slow_down" }).mockResolvedValueOnce({
        status: "approved",
        tokens: { access_token: "t", token_type: "bearer" },
      });

      const pending = performDeviceLogin(false);
      // First poll fires after the initial 0ms interval; slow_down then
      // bumps the interval by 5000ms before the second poll.
      await vi.advanceTimersByTimeAsync(5500);
      const result = await pending;
      expect(result).toBe("t");
      expect(mockPollDeviceToken).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("returns null when start request throws", async () => {
    mockStartDeviceAuthorization.mockRejectedValue(new Error("network down"));

    expect(await performDeviceLogin(false)).toBeNull();
    expect(mockPollDeviceToken).not.toHaveBeenCalled();
  });

  test("opens verification_uri_complete when openBrowser=true and stdin is non-TTY", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    try {
      mockStartDeviceAuthorization.mockResolvedValue(authorization);
      mockPollDeviceToken.mockResolvedValue({
        status: "approved",
        tokens: { access_token: "t", token_type: "bearer" },
      });

      await performDeviceLogin(true);
      expect(mockOpen).toHaveBeenCalledWith(authorization.verification_uri_complete);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  test("skips opening a browser when openBrowser=false", async () => {
    mockStartDeviceAuthorization.mockResolvedValue(authorization);
    mockPollDeviceToken.mockResolvedValue({
      status: "approved",
      tokens: { access_token: "t", token_type: "bearer" },
    });

    await performDeviceLogin(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  test("defaults poll interval to 5s when server omits it (RFC 8628 §3.2)", async () => {
    vi.useFakeTimers();
    try {
      mockStartDeviceAuthorization.mockResolvedValue({ ...authorization, interval: undefined });
      mockPollDeviceToken.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({
        status: "approved",
        tokens: { access_token: "t", token_type: "bearer" },
      });

      const pending = performDeviceLogin(false);
      // Two 5s polls.
      await vi.advanceTimersByTimeAsync(11_000);
      const result = await pending;
      expect(result).toBe("t");
      expect(mockPollDeviceToken).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
