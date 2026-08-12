import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_DIRECTORY = ".docs7";
const PROJECT_FILE = "project.json";

/** Local link between one documentation directory and one hosted Docs7 site. */
export type DocsProjectLink = { readonly siteId: string };

function projectFile(projectDir: string): string {
  return path.join(projectDir, PROJECT_DIRECTORY, PROJECT_FILE);
}

/** Read the local Docs7 project link, or null when the directory is not linked. */
export async function loadDocsProjectLink(projectDir: string): Promise<DocsProjectLink | null> {
  let raw: string;
  try {
    raw = await fs.readFile(projectFile(projectDir), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("siteId" in value) ||
    typeof value.siteId !== "string" ||
    value.siteId === ""
  ) {
    throw new Error(".docs7/project.json does not contain a valid siteId");
  }
  return { siteId: value.siteId };
}

/** Save the local link to one hosted Docs7 site. */
export async function saveDocsProjectLink(
  projectDir: string,
  link: DocsProjectLink
): Promise<void> {
  const directory = path.join(projectDir, PROJECT_DIRECTORY);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(projectFile(projectDir), `${JSON.stringify(link, null, 2)}\n`, {
    mode: 0o600,
  });
}
