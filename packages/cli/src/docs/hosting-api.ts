import fs from "node:fs/promises";
import { getBaseUrl } from "../utils/api.js";

/** One hosted Docs7 site visible to the authenticated teamspace. */
export type DocsSite = {
  readonly id: string;
  readonly name: string;
  readonly repoUrl: string | null;
};

/** Current state of one Docs7 CLI deployment. */
export type DocsDeployment = {
  readonly id: string;
  readonly state: "queued" | "running" | "ready" | "failed";
  readonly url: string;
  readonly failureMessage: string | null;
};

/** Deployment plus its short-lived source upload credential. */
export type DocsDeploymentUpload = {
  readonly deployment: DocsDeployment;
  readonly sourceUploadToken: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: Readonly<Record<string, unknown>>, name: string): string | null {
  const field = value[name];
  return typeof field === "string" && field !== "" ? field : null;
}

function parseDeployment(value: unknown): DocsDeployment | null {
  if (!isRecord(value)) return null;
  const id = requiredString(value, "id");
  const state = requiredString(value, "state");
  const url = requiredString(value, "url");
  const failureMessage = value.failureMessage;
  if (!id || !url || (failureMessage !== null && typeof failureMessage !== "string")) return null;
  if (state !== "queued" && state !== "running" && state !== "ready" && state !== "failed")
    return null;
  return { id, state, url, failureMessage };
}

async function responseError(response: Response): Promise<Error> {
  const value: unknown = await response.json().catch(() => null);
  const message =
    isRecord(value) && typeof value.message === "string"
      ? value.message
      : `Docs7 returned HTTP ${response.status}`;
  return new Error(message);
}

function authorization(accessToken: string): Headers {
  return new Headers({ Authorization: `Bearer ${accessToken}` });
}

/** List Docs7 sites in the authenticated teamspace. */
export async function listDocsSites(accessToken: string): Promise<ReadonlyArray<DocsSite>> {
  const response = await fetch(`${getBaseUrl()}/api/v2/docs/sites`, {
    headers: authorization(accessToken),
  });
  if (!response.ok) throw await responseError(response);
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.data))
    throw new Error("Docs7 returned an invalid site list");
  return value.data.map((item: unknown) => {
    if (!isRecord(item)) throw new Error("Docs7 returned an invalid site");
    const id = requiredString(item, "id");
    const name = requiredString(item, "name");
    const repoUrl = item.repoUrl;
    if (!id || !name || (repoUrl !== null && typeof repoUrl !== "string")) {
      throw new Error("Docs7 returned an invalid site");
    }
    return { id, name, repoUrl };
  });
}

/** Create a CLI-owned Docs7 site with a caller-generated stable ID. */
export async function createDocsSite(
  accessToken: string,
  input: { readonly id: string; readonly name: string }
): Promise<DocsSite> {
  const headers = authorization(accessToken);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${getBaseUrl()}/api/v2/docs/sites`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response);
  const value: unknown = await response.json();
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error("Docs7 returned an invalid site");
  }
  const id = requiredString(value.data, "id");
  const name = requiredString(value.data, "name");
  if (!id || !name || value.data.repoUrl !== null) {
    throw new Error("Docs7 returned an invalid site");
  }
  return { id, name, repoUrl: null };
}

/** Create one Docs7 deployment and obtain its source upload instructions. */
export async function createDocsDeployment(
  accessToken: string,
  siteId: string,
  target: "preview" | "production"
): Promise<DocsDeploymentUpload> {
  const headers = authorization(accessToken);
  headers.set("Content-Type", "application/json");
  const response = await fetch(
    `${getBaseUrl()}/api/v2/docs/sites/${encodeURIComponent(siteId)}/deployments`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ target }),
    }
  );
  if (!response.ok) throw await responseError(response);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Docs7 returned an invalid deployment");
  const deployment = parseDeployment(value.deployment);
  const sourceUploadToken = requiredString(value, "sourceUploadToken");
  if (!deployment || !sourceUploadToken) throw new Error("Docs7 returned an invalid deployment");
  return { deployment, sourceUploadToken };
}

/** Upload one local documentation source archive through the Context7 API. */
export async function uploadDocsSource(
  sourceUploadToken: string,
  siteId: string,
  deploymentId: string,
  archivePath: string
): Promise<void> {
  const headers = authorization(sourceUploadToken);
  headers.set("Content-Type", "application/gzip");
  const response = await fetch(
    `${getBaseUrl()}/api/v2/docs/sites/${encodeURIComponent(siteId)}/deployments/${encodeURIComponent(deploymentId)}/source`,
    { method: "POST", headers, body: await fs.readFile(archivePath) }
  );
  if (!response.ok) throw await responseError(response);
}

/** Read the current state of one Docs7 deployment. */
export async function getDocsDeployment(
  accessToken: string,
  siteId: string,
  deploymentId: string
): Promise<DocsDeployment> {
  const response = await fetch(
    `${getBaseUrl()}/api/v2/docs/sites/${encodeURIComponent(siteId)}/deployments/${encodeURIComponent(deploymentId)}`,
    { headers: authorization(accessToken) }
  );
  if (!response.ok) throw await responseError(response);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("Docs7 returned an invalid deployment");
  const deployment = parseDeployment(value.data);
  if (!deployment) throw new Error("Docs7 returned an invalid deployment");
  return deployment;
}
