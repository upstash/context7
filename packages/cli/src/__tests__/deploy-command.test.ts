import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Command } from "commander";
import { registerDeployCommands } from "../commands/deploy.js";
import { setBaseUrl } from "../utils/api.js";

const DEPLOYMENT_ID = "22222222-2222-4222-8222-222222222222";

async function requestJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

afterEach(() => {
  delete process.env.CONTEXT7_API_KEY;
  setBaseUrl("https://context7.com");
  vi.restoreAllMocks();
});

describe("deploy command", () => {
  test("uses the existing API key, creates its own site, deploys, and prints the URL", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx7-deploy-test-"));
    fs.writeFileSync(
      path.join(projectDir, "docs.json"),
      JSON.stringify({ name: "CLI Docs", navigation: { pages: ["index"] } })
    );
    fs.writeFileSync(path.join(projectDir, "index.mdx"), "---\ntitle: Home\n---\n\nHello.");
    execFileSync("git", ["-C", projectDir, "init"]);
    execFileSync("git", [
      "-C",
      projectDir,
      "remote",
      "add",
      "origin",
      "git@github.com:acme/docs.git",
    ]);

    let uploaded = Buffer.alloc(0);
    let siteId: string | null = null;
    const server = http.createServer(async (request, response) => {
      if (request.method === "POST" && request.url === "/api/v2/cli/events") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && request.url === "/api/v2/docs/sites") {
        expect(request.headers.authorization).toBe("Bearer test-key");
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            data: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Existing Git site",
                repoUrl: "https://github.com/acme/docs",
              },
            ],
          })
        );
        return;
      }
      if (request.method === "POST" && request.url === "/api/v2/docs/sites") {
        const body = await requestJson(request);
        if (typeof body !== "object" || body === null || !("id" in body)) {
          throw new Error("Site creation did not include an ID");
        }
        siteId = typeof body.id === "string" ? body.id : null;
        expect(siteId).toMatch(/^[0-9a-f-]{36}$/);
        expect(body).toMatchObject({ name: "CLI Docs" });
        response.statusCode = 201;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ data: { id: siteId, name: "CLI Docs", repoUrl: null } }));
        return;
      }
      if (
        request.method === "POST" &&
        siteId !== null &&
        request.url === `/api/v2/docs/sites/${siteId}/deployments`
      ) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            deployment: {
              id: DEPLOYMENT_ID,
              state: "queued",
              url: "https://preview.example.docs7.io",
              failureMessage: null,
            },
            sourceUploadToken: "upload-token",
          })
        );
        return;
      }
      if (
        request.method === "POST" &&
        siteId !== null &&
        request.url === `/api/v2/docs/sites/${siteId}/deployments/${DEPLOYMENT_ID}/source`
      ) {
        expect(request.headers.authorization).toBe("Bearer upload-token");
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        uploaded = Buffer.concat(chunks);
        response.statusCode = 202;
        response.end();
        return;
      }
      if (
        request.method === "GET" &&
        siteId !== null &&
        request.url === `/api/v2/docs/sites/${siteId}/deployments/${DEPLOYMENT_ID}`
      ) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            data: {
              id: DEPLOYMENT_ID,
              state: "ready",
              url: "https://preview.example.docs7.io",
              failureMessage: null,
            },
          })
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const addressValue = server.address();
    if (!addressValue || typeof addressValue === "string")
      throw new Error("The test server did not start");
    const address = addressValue;

    try {
      setBaseUrl(`http://127.0.0.1:${address.port}`);
      process.env.CONTEXT7_API_KEY = "test-key";
      const stdout: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...values: unknown[]) =>
        stdout.push(values.join(" "))
      );
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const program = new Command();
      program.exitOverride();
      registerDeployCommands(program);
      await program.parseAsync(["node", "ctx7", "deploy", projectDir]);

      expect(stdout.at(-1)).toBe("https://preview.example.docs7.io");
      expect(uploaded[0]).toBe(0x1f);
      expect(uploaded[1]).toBe(0x8b);
      expect(siteId).not.toBeNull();
      expect(
        JSON.parse(fs.readFileSync(path.join(projectDir, ".docs7/project.json"), "utf8"))
      ).toEqual({
        siteId,
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
