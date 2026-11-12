export type SubmitLibraryKind =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "git"
  | "website"
  | "openapi"
  | "llmstxt";

export interface ResolvedSubmitTarget {
  kind: SubmitLibraryKind;
  endpointPath: string;
  body: Record<string, unknown>;
}

export interface SubmitRepoOptions {
  private?: boolean;
  gitToken?: string;
  skipVersionFiltering?: boolean;
  generateDocs?: boolean;
  websiteBaseUrl?: string;
}

const SUBMIT_KINDS: SubmitLibraryKind[] = [
  "github",
  "gitlab",
  "bitbucket",
  "git",
  "website",
  "openapi",
  "llmstxt",
];

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim();
  try {
    return new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Infer the Add Library API target from a URL and an optional explicit kind.
 * This chooses where Context7 should index the source. It does not install anything locally.
 */
export function resolveSubmitTarget(
  url: string,
  kind: SubmitLibraryKind | undefined,
  repoOptions: SubmitRepoOptions = {}
): ResolvedSubmitTarget {
  const parsed = normalizeUrl(url);
  const resolvedKind = kind ?? detectSubmitKind(parsed);

  if (repoOptions.websiteBaseUrl && resolvedKind !== "website") {
    throw new Error(
      "--website-base-url applies only to a website source. Pass --type website or a documentation site URL."
    );
  }

  if (resolvedKind === "website") {
    const body: Record<string, unknown> = { websiteUrl: parsed.toString() };
    if (repoOptions.websiteBaseUrl) {
      body.websiteBaseUrl = normalizeUrl(repoOptions.websiteBaseUrl).toString();
    }
    return {
      kind: "website",
      endpointPath: "/api/v2/add/website",
      body,
    };
  }

  if (resolvedKind === "openapi") {
    return {
      kind: "openapi",
      endpointPath: "/api/v2/add/openapi",
      body: { openApiUrl: parsed.toString() },
    };
  }

  if (resolvedKind === "llmstxt") {
    return {
      kind: "llmstxt",
      endpointPath: "/api/v2/add/llmstxt",
      body: { llmstxtUrl: parsed.toString() },
    };
  }

  const body: Record<string, unknown> = {
    docsRepoUrl: parsed.toString(),
  };
  if (repoOptions.private !== undefined) body.private = repoOptions.private;
  if (repoOptions.gitToken) body.gitToken = repoOptions.gitToken;
  if (repoOptions.skipVersionFiltering !== undefined) {
    body.skipVersionFiltering = repoOptions.skipVersionFiltering;
  }
  if (repoOptions.generateDocs !== undefined) body.generateDocs = repoOptions.generateDocs;

  const endpointPath =
    resolvedKind === "github"
      ? "/api/v2/add/repo/github"
      : resolvedKind === "gitlab"
        ? "/api/v2/add/repo/gitlab"
        : resolvedKind === "bitbucket"
          ? "/api/v2/add/repo/bitbucket"
          : "/api/v2/add/repo/git";

  return { kind: resolvedKind, endpointPath, body };
}

export function detectSubmitKind(parsed: URL): SubmitLibraryKind {
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith("llms.txt") || path.endsWith("/llms-full.txt")) {
    return "llmstxt";
  }
  if (
    path.includes("openapi") &&
    (path.endsWith(".json") || path.endsWith(".yaml") || path.endsWith(".yml"))
  ) {
    return "openapi";
  }

  if (hostMatches(parsed.hostname, "github.com")) return "github";
  if (hostMatches(parsed.hostname, "gitlab.com")) return "gitlab";
  if (hostMatches(parsed.hostname, "bitbucket.org")) return "bitbucket";

  // Explicit git remotes only. A docs URL with several path segments is still a website.
  if (parsed.protocol === "git:" || parsed.pathname.toLowerCase().endsWith(".git")) {
    return "git";
  }

  return "website";
}

export function parseSubmitKind(value: string | undefined): SubmitLibraryKind | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (!SUBMIT_KINDS.includes(normalized as SubmitLibraryKind)) {
    throw new Error(`Invalid --type "${value}". Expected one of: ${SUBMIT_KINDS.join(", ")}`);
  }
  return normalized as SubmitLibraryKind;
}
