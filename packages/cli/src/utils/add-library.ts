export type AddLibraryKind =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "git"
  | "website"
  | "openapi"
  | "llmstxt";

export interface ResolvedAddTarget {
  kind: AddLibraryKind;
  endpointPath: string;
  body: Record<string, unknown>;
}

export interface AddRepoOptions {
  private?: boolean;
  gitToken?: string;
  skipVersionFiltering?: boolean;
  generateDocs?: boolean;
}

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
 * Infer the Add Library API target from a URL and optional explicit kind.
 */
export function resolveAddTarget(
  url: string,
  kind: AddLibraryKind | undefined,
  repoOptions: AddRepoOptions = {}
): ResolvedAddTarget {
  const parsed = normalizeUrl(url);
  const resolvedKind = kind ?? detectKind(parsed);

  if (resolvedKind === "website") {
    return {
      kind: "website",
      endpointPath: "/api/v2/add/website",
      body: { websiteUrl: parsed.toString() },
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

export function detectKind(parsed: URL): AddLibraryKind {
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

  // Explicit git remotes only — do not treat multi-segment docs URLs as git repos.
  if (parsed.protocol === "git:" || parsed.pathname.toLowerCase().endsWith(".git")) {
    return "git";
  }

  return "website";
}

export function parseAddKind(value: string | undefined): AddLibraryKind | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  const allowed: AddLibraryKind[] = [
    "github",
    "gitlab",
    "bitbucket",
    "git",
    "website",
    "openapi",
    "llmstxt",
  ];
  if (!allowed.includes(normalized as AddLibraryKind)) {
    throw new Error(
      `Invalid --type "${value}". Expected one of: ${allowed.join(", ")}`
    );
  }
  return normalized as AddLibraryKind;
}
