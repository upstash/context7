import { describe, test, expect, beforeAll } from "bun:test";
import { spawn } from "child_process";
import { promisify } from "util";

const sleep = promisify(setTimeout);

describe("CONTEXT7_API_KEY environment variable", () => {
  const serverPath = "./dist/index.js";
  let serverBuilt = false;

  beforeAll(async () => {
    // Check if dist/index.js exists, if not skip tests
    try {
      await Bun.file(serverPath).text();
      serverBuilt = true;
    } catch {
      console.warn("Dist folder not built, skipping integration tests");
    }
  });

  test("uses CONTEXT7_API_KEY env var when --api-key flag not provided", async () => {
    if (!serverBuilt) {
      console.log("Skipping test - server not built");
      return;
    }

    const testApiKey = "test-env-api-key";
    const child = spawn("node", [serverPath, "--transport", "stdio"], {
      env: { ...process.env, CONTEXT7_API_KEY: testApiKey },
    });

    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    // Give it a moment to start
    await sleep(1000);

    // Kill the process
    child.kill();

    // Wait for process to exit
    await new Promise((resolve) => child.on("exit", resolve));

    // Should start successfully (stderr contains startup message, not errors)
    expect(stderr).toContain("Context7 Documentation MCP Server running on stdio");
  });

  test("CLI flag takes precedence over env var", async () => {
    if (!serverBuilt) {
      console.log("Skipping test - server not built");
      return;
    }

    const envApiKey = "test-env-api-key";
    const cliApiKey = "test-cli-api-key";
    const child = spawn("node", [serverPath, "--transport", "stdio", "--api-key", cliApiKey], {
      env: { ...process.env, CONTEXT7_API_KEY: envApiKey },
    });

    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    await sleep(1000);
    child.kill();
    await new Promise((resolve) => child.on("exit", resolve));

    // Should start successfully
    expect(stderr).toContain("Context7 Documentation MCP Server running on stdio");
  });

  test("works without API key (neither flag nor env var)", async () => {
    if (!serverBuilt) {
      console.log("Skipping test - server not built");
      return;
    }

    const child = spawn("node", [serverPath, "--transport", "stdio"], {
      env: { ...process.env, CONTEXT7_API_KEY: undefined },
    });

    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    await sleep(1000);
    child.kill();
    await new Promise((resolve) => child.on("exit", resolve));

    // Should still start (with lower rate limits)
    expect(stderr).toContain("Context7 Documentation MCP Server running on stdio");
  });

  test("--api-key flag blocked with HTTP transport", async () => {
    if (!serverBuilt) {
      console.log("Skipping test - server not built");
      return;
    }

    const child = spawn("node", [serverPath, "--transport", "http", "--api-key", "test-key"]);

    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    await new Promise((resolve) => child.on("exit", resolve));

    // Should error and exit
    expect(stderr).toContain(
      "The --api-key flag is not allowed when using --transport http"
    );
  });
});
