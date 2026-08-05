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

function normalizeUrl(raw: string): URL {
  try {
    return new URL(raw.trim());
  } catch {
    throw new Error(`Invalid URL: "${raw}"`);
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
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
  if (parsed.protocol === "git:" || path.endsWith(".git")) return "git";
  return "website";
}

export function resolveAddTarget(
  url: string,
  kind?: AddLibraryKind,
  options: { private?: boolean; gitToken?: string } = {}
): ResolvedAddTarget {
  const parsed = normalizeUrl(url);
  const resolvedKind = kind ?? detectKind(parsed);

  if (resolvedKind === "website") {
    return {
      kind: "website",
      endpointPath: "/v2/add/website",
      body: { websiteUrl: parsed.toString() },
    };
  }
  if (resolvedKind === "openapi") {
    return {
      kind: "openapi",
      endpointPath: "/v2/add/openapi",
      body: { openApiUrl: parsed.toString() },
    };
  }
  if (resolvedKind === "llmstxt") {
    return {
      kind: "llmstxt",
      endpointPath: "/v2/add/llmstxt",
      body: { llmstxtUrl: parsed.toString() },
    };
  }

  const body: Record<string, unknown> = { docsRepoUrl: parsed.toString() };
  if (options.private !== undefined) body.private = options.private;
  if (options.gitToken) body.gitToken = options.gitToken;

  const endpointPath =
    resolvedKind === "github"
      ? "/v2/add/repo/github"
      : resolvedKind === "gitlab"
        ? "/v2/add/repo/gitlab"
        : resolvedKind === "bitbucket"
          ? "/v2/add/repo/bitbucket"
          : "/v2/add/repo/git";

  return { kind: resolvedKind, endpointPath, body };
}
