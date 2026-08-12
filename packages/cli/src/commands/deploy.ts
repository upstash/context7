import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  createDocsDeployment,
  createDocsSite,
  getDocsDeployment,
  listDocsSites,
  uploadDocsSource,
  type DocsSite,
} from "../docs/hosting-api.js";
import { loadDocsProjectLink, saveDocsProjectLink } from "../docs/project-link.js";
import { createSourceArchive } from "../docs/source-archive.js";
import { getValidAccessToken } from "../utils/auth.js";
import { trackEvent } from "../utils/tracking.js";

function progress(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function accessToken(): Promise<string> {
  const environmentToken = process.env.CONTEXT7_API_KEY?.trim();
  const token = environmentToken || (await getValidAccessToken());
  if (!token) throw new Error("You are not signed in. Run `ctx7 login`, then try again.");
  return token;
}

function gitRemote(directory: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", ["-C", directory, "remote", "get-url", "origin"], (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

function normalizedRepository(value: string): string {
  const scp = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(value);
  const repository =
    scp?.[1] ?? value.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  return repository.toLowerCase();
}

function sitesMessage(sites: ReadonlyArray<DocsSite>): string {
  return sites.map((site) => `  ${site.id}  ${site.name}`).join("\n");
}

async function selectSite(
  projectDir: string,
  token: string,
  explicitSiteId?: string
): Promise<DocsSite> {
  const sites = await listDocsSites(token);
  if (sites.length === 0) {
    throw new Error("No Docs7 sites found. Run `ctx7 deploy .` to create and deploy one.");
  }
  const linked = explicitSiteId ? null : await loadDocsProjectLink(projectDir);
  const siteId = explicitSiteId ?? linked?.siteId;
  let site = siteId ? sites.find((candidate) => candidate.id === siteId) : undefined;
  if (!site && siteId)
    throw new Error(`The linked Docs7 site ${siteId} is not available to this teamspace.`);
  if (!site) {
    const remote = await gitRemote(projectDir);
    if (remote) {
      const normalizedRemote = normalizedRepository(remote);
      const matches = sites.filter(
        (candidate) =>
          candidate.repoUrl !== null && normalizedRepository(candidate.repoUrl) === normalizedRemote
      );
      if (matches.length === 1) site = matches[0];
    }
  }
  if (!site)
    throw new Error(`Choose a site with --site <id>. Available sites:\n${sitesMessage(sites)}`);
  await saveDocsProjectLink(projectDir, { siteId: site.id });
  return site;
}

async function projectName(projectDir: string): Promise<string> {
  for (const fileName of ["docs.json", "mint.json"]) {
    try {
      const value: unknown = JSON.parse(await fs.readFile(path.join(projectDir, fileName), "utf8"));
      if (typeof value === "object" && value !== null && "name" in value) {
        const name = value.name;
        if (typeof name === "string" && name.trim()) return name.trim().slice(0, 100);
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return path.basename(projectDir).slice(0, 100) || "Documentation";
}

async function siteForDeploy(
  projectDir: string,
  token: string,
  explicitSiteId?: string
): Promise<DocsSite> {
  const sites = await listDocsSites(token);
  const linked = await loadDocsProjectLink(projectDir);
  const requestedSiteId = explicitSiteId ?? linked?.siteId;
  if (requestedSiteId) {
    const existing = sites.find((site) => site.id === requestedSiteId);
    if (existing) {
      await saveDocsProjectLink(projectDir, { siteId: existing.id });
      return existing;
    }
    if (explicitSiteId) {
      throw new Error(`Docs7 site ${explicitSiteId} is not available to this teamspace.`);
    }
  }

  const siteId = randomUUID();
  await saveDocsProjectLink(projectDir, { siteId });
  return await createDocsSite(token, { id: siteId, name: await projectName(projectDir) });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function linkCommand(directory: string, siteId?: string): Promise<void> {
  trackEvent("command", { name: "link" });
  const projectDir = path.resolve(directory);
  try {
    const site = await selectSite(projectDir, await accessToken(), siteId);
    console.log(`Linked ${projectDir} to ${site.name} (${site.id})`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

async function deployCommand(
  directory: string,
  options: { readonly prod?: boolean; readonly site?: string }
): Promise<void> {
  trackEvent("command", { name: "deploy" });
  const projectDir = path.resolve(directory);
  let temporaryDirectory: string | null = null;
  try {
    const hasConfig = await Promise.all([
      fs.access(path.join(projectDir, "docs.json")).then(
        () => true,
        () => false
      ),
      fs.access(path.join(projectDir, "mint.json")).then(
        () => true,
        () => false
      ),
    ]);
    if (!hasConfig.some(Boolean)) {
      throw new Error("The documentation directory does not contain docs.json or mint.json.");
    }
    const token = await accessToken();
    const site = await siteForDeploy(projectDir, token, options.site);
    progress(`Deploying ${site.name}`);

    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ctx7-deploy-"));
    const archivePath = path.join(temporaryDirectory, "source.tar.gz");
    progress("Preparing documentation source");
    await createSourceArchive(projectDir, archivePath);

    const target = options.prod ? "production" : "preview";
    const upload = await createDocsDeployment(token, site.id, target);
    progress(`Uploading ${target} deployment`);
    await uploadDocsSource(upload.sourceUploadToken, site.id, upload.deployment.id, archivePath);

    const deadline = Date.now() + 15 * 60_000;
    let currentDeployment = upload.deployment;
    while (currentDeployment.state === "queued" || currentDeployment.state === "running") {
      if (Date.now() >= deadline)
        throw new Error(`Deployment ${currentDeployment.id} did not finish before the timeout.`);
      await wait(1_000);
      currentDeployment = await getDocsDeployment(token, site.id, currentDeployment.id);
    }
    if (currentDeployment.state === "failed")
      throw new Error(currentDeployment.failureMessage ?? "The deployment failed.");
    console.log(currentDeployment.url);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Register Docs7 project linking and deployment commands. */
export function registerDeployCommands(program: Command): void {
  program
    .command("link")
    .description("Link a local documentation directory to an existing Docs7 site")
    .argument("[dir]", "Documentation directory", ".")
    .option("--site <id>", "Hosted Docs7 site ID")
    .action(async (directory: string, options: { readonly site?: string }) => {
      await linkCommand(directory, options.site);
    });

  program
    .command("deploy")
    .description("Deploy local documentation files to Docs7")
    .argument("[dir]", "Documentation directory", ".")
    .option("--prod", "Deploy to production instead of the CLI preview")
    .option("--site <id>", "Hosted Docs7 site ID and save the link")
    .action(
      async (directory: string, options: { readonly prod?: boolean; readonly site?: string }) => {
        await deployCommand(directory, options);
      }
    );
}
