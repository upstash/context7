import { z } from "zod";

/** `read` changes nothing; `destructive` deletes data that cannot be restored. */
export type Kind = "read" | "write" | "destructive";

type Query = Record<string, string | number | boolean | undefined>;

/** Calls one management API endpoint with the caller's credential. */
export interface Api {
  get(path: string, query?: Query): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  patch(path: string, body: unknown): Promise<unknown>;
  put(path: string, body: unknown): Promise<unknown>;
  del(path: string, options?: { query?: Query; body?: unknown }): Promise<unknown>;
}

/** A refusal or bad argument: shown to the model as a tool error. */
export class ToolError extends Error {}

type Args<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>> & {
  teamspace: string;
  action: string;
};

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** A plain tool has one kind; an action tool has one kind per `action` value. */
  kind?: Kind;
  actions?: Record<string, Kind>;
  /** Only for write tools: a second identical call changes nothing more. */
  idempotent?: boolean;
  /** The result holds third-party text (questions, queries, feedback, logs, PR text). */
  untrusted?: boolean;
  /** `false` for the one tool that works across teamspaces. */
  teamspace?: false;
  args: S;
  run(args: Args<S>, api: Api): Promise<unknown>;
}

function tool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

/** One URL path segment. Rejects dot segments, which the URL parser would resolve. */
function seg(value: string): string {
  if (!value || value === "." || value === "..") throw new ToolError(`Invalid id "${value}".`);
  return encodeURIComponent(value);
}

/** The field of the management API's add body that holds each source's URL. */
const ADD_URL_FIELDS: Record<string, string | undefined> = {
  github: "docsRepoUrl",
  gitlab: "docsRepoUrl",
  bitbucket: "docsRepoUrl",
  git: "docsRepoUrl",
  website: "websiteUrl",
  llmstxt: "llmstxtUrl",
  openapi: "openApiUrl",
};

const ts = (id: string) => `/v2/teamspaces/${seg(id)}`;

/**
 * A library id as Context7 stores it: `/owner/repo`, lowercase. Also takes
 * `owner/repo` and a context7.com library URL, which agents often pass.
 */
export function normalizeLibraryId(value: string): string {
  const path = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?context7\.com/i, "")
    .replace(/\/+$/, "");
  const id = (path.startsWith("/") ? path : `/${path}`).toLowerCase();
  if (!/^\/[^/]+\/[^/]+$/.test(id)) {
    throw new ToolError(
      `"${value}" is not a library id. Use one like "/owner/repo" (from list_libraries).`
    );
  }
  return id;
}

function lib(teamspace: string, libraryId: string): string {
  const [, owner, repo] = normalizeLibraryId(libraryId).split("/");
  return `${ts(teamspace)}/libraries/${seg(owner)}/${seg(repo)}`;
}

/**
 * Calls `fetchOnce` until `isDone` holds or about 25 seconds pass, so an agent
 * waits for a parse, build or crawl in one tool call instead of polling.
 * Gives the last answer either way; its state says whether the job finished.
 */
export async function poll(
  fetchOnce: () => Promise<unknown>,
  isDone: (value: unknown) => boolean,
  { timeoutMs = 25_000, intervalMs = 3_000 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let value = await fetchOnce();
  while (!isDone(value) && Date.now() + intervalMs < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    value = await fetchOnce();
  }
  return value;
}

const wait = z
  .boolean()
  .optional()
  .describe("Wait up to about 25 seconds for the job to finish before answering.");

/**
 * What an agent needs from a Docs7 site in a list: what it is, where it is
 * served, and how its agents are set. Internal ids (worker, installation,
 * repository, creator) stay out; docs7_get_site has every field.
 */
function siteSummary(site: Record<string, unknown>): Record<string, unknown> {
  const review = site.pullRequestReview as { enabled?: unknown } | undefined;
  const watch = site.codeWatch as { enabled?: unknown; repositories?: unknown[] } | undefined;
  return {
    id: site.id,
    name: site.name,
    repoUrl: site.repoUrl,
    branch: site.branch ?? site.defaultBranch,
    docsPath: site.docsPath,
    hosting: site.hosting,
    // A proxy-routed site is built under its custom domain path, on docs7.io too.
    url: site.platformHostname
      ? `https://${site.platformHostname}${site.customDomainRouting === "proxy" ? (site.customDomainPath ?? "") : ""}`
      : undefined,
    customDomain: site.customDomain
      ? `${site.customDomain}${site.customDomainPath ?? ""}`
      : undefined,
    customDomainStatus: site.customDomain ? site.customDomainStatus : undefined,
    libraryId: site.context7LibraryName,
    improveSchedule: site.improveSchedule,
    buildFixSchedule: site.buildFixSchedule,
    pullRequestReview: review?.enabled,
    codeWatchRepositories: watch?.enabled ? watch.repositories?.length : undefined,
  };
}

/** One site with every setting an agent can act on; internal ids stay out. */
function siteDetails(site: Record<string, unknown>): Record<string, unknown> {
  const watch = site.codeWatch as { enabled?: unknown; repositories?: { repoUrl?: unknown }[] };
  const records = site.customDomainRecords as unknown[] | undefined;
  return {
    ...siteSummary(site),
    source: site.source === "local" ? "cli" : "github",
    // As docs7_update_site takes them: null branch follows the repository default.
    branch: site.branch ?? null,
    defaultBranch: site.defaultBranch,
    // Two fields, as docs7_update_site takes them; the list joins them.
    customDomain: site.customDomain,
    customDomainPath: site.customDomain ? site.customDomainPath : undefined,
    customDomainRouting: site.customDomain ? site.customDomainRouting : undefined,
    customDomainRecords: records?.length ? records : undefined,
    context7Index: site.context7Index,
    analyticsUrl: site.analyticsUrl,
    pullRequestReview: site.pullRequestReview,
    // docs7_update_site takes `enabled` and the full list, so both stay, also while it is off.
    codeWatchRepositories: undefined,
    codeWatch: watch && {
      enabled: watch.enabled,
      repositories: watch.repositories?.map((repository) => repository.repoUrl),
    },
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  };
}

/** The agent of a run, as the dashboard names it, from the run's input kind. */
function runAgent(run: { input?: { kind?: unknown } }): string {
  switch (run.input?.kind) {
    case "review":
      return "prReview";
    case "code_change":
      return "codeWatch";
    case "health":
      return "buildFix";
    default:
      return "context7";
  }
}

type AgentRun = {
  state?: unknown;
  createdAt?: unknown;
  input?: { kind?: unknown };
  pullRequest?: { state?: unknown };
};

/** The agents whose runs each agent-runs history holds. */
const HISTORY_AGENTS = {
  improve: ["context7", "buildFix"],
  review: ["prReview"],
  watch: ["codeWatch"],
} as const;
type AgentHistory = keyof typeof HISTORY_AGENTS;

/** The most runs the agent-runs route gives per history. */
export const AGENT_HISTORY_LIMIT = 50;

/**
 * This UTC month's runs of each agent and the states of their pull requests,
 * read from the newest 50 runs of each history, as the dashboard's Agents card
 * counts them. Superseded runs are left out, as there. When a full history
 * starts inside the month, older runs of the month are not read: its agents
 * are named in `minimumCounts`.
 */
export function agentActivity(
  histories: Record<AgentHistory, AgentRun[]>,
  now = new Date()
): Record<string, unknown> {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const inMonth = (run: AgentRun) =>
    typeof run.createdAt === "string" && Date.parse(run.createdAt) >= monthStart;
  const minimumCounts = new Set<string>();
  for (const history of Object.keys(HISTORY_AGENTS) as AgentHistory[]) {
    const list = histories[history];
    if (list.length >= AGENT_HISTORY_LIMIT && list.every(inMonth)) {
      // An agent can be missing from the window and still have older runs this month.
      for (const agent of HISTORY_AGENTS[history]) minimumCounts.add(agent);
    }
  }
  const runs: Record<string, number> = {};
  const failedRuns: Record<string, number> = {};
  const pullRequests: Record<string, Record<string, number>> = {};
  for (const run of Object.values(histories).flat()) {
    if (run.state === "superseded" || !inMonth(run)) continue;
    const agent = runAgent(run);
    runs[agent] = (runs[agent] ?? 0) + 1;
    if (run.state === "failed") failedRuns[agent] = (failedRuns[agent] ?? 0) + 1;
    const state = run.pullRequest?.state;
    if (typeof state === "string") {
      const counts = (pullRequests[agent] ??= {});
      counts[state] = (counts[state] ?? 0) + 1;
    }
  }
  return {
    month: new Date(monthStart).toISOString().slice(0, 7),
    runs,
    failedRuns,
    pullRequests,
    minimumCounts: minimumCounts.size ? [...minimumCounts] : undefined,
  };
}

const RUN_NOISE = new Set(["boxId", "siteId"]);

/**
 * A run with the machine-readable blocks of its summary as fields: per
 * suggestion results and the pull request title. Box and site ids stay out.
 */
function runView(run: Record<string, unknown>): Record<string, unknown> {
  const { summary, ...rest } = without(run, RUN_NOISE) as Record<string, unknown>;
  if (typeof summary !== "string") return rest;
  const block = (name: string) => summary.match(new RegExp(`<!-- ${name}\\n([\\s\\S]*?)\\n-->`));
  const results = block("docs7-suggestion-results");
  const title = block("docs7-pr-title");
  let parsed: unknown;
  try {
    parsed = results ? JSON.parse(results[1]) : undefined;
  } catch {
    parsed = undefined;
  }
  return {
    ...rest,
    prTitle: title?.[1].trim(),
    suggestionResults: parsed,
    summary: summary.replace(/<!-- docs7-[\s\S]*?-->\n?/g, "").trim() || undefined,
  };
}

/** The value with these keys removed at every depth. */
function without(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => without(item, keys));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !keys.has(key))
      .map(([key, item]) => [key, without(item, keys)])
  );
}

/** Deployment fields an agent never needs: the site it asked for, Worker names. */
const DEPLOYMENT_NOISE = new Set(["siteId", "workerName", "attributionRequired"]);

/** A build without its noise; `requestedCommitSha` only when the build ran another commit. */
function deploymentView(deployment: unknown): unknown {
  const view = without(deployment, DEPLOYMENT_NOISE) as Record<string, unknown>;
  if (view && view.requestedCommitSha === view.commitSha) delete view.requestedCommitSha;
  return view;
}

/** A Docs7 site deployed from the CLI (`source: "local"`), which has its own build routes. */
async function isCliSite(api: Api, sitePath: string): Promise<boolean> {
  return data(await api.get(sitePath)).source === "local";
}

/** The `state` (or `indexStatus.kind`) of a result, read through a `{ data }` envelope. */
function stateOf(value: unknown, key: "state" | "indexStatus"): unknown {
  const record = data(value);
  return key === "state" ? record.state : (record.indexStatus as { kind?: unknown })?.kind;
}

const site = (teamspace: string, siteId: string) => `${ts(teamspace)}/sites/${seg(siteId)}`;
const askSite = (teamspace: string, siteKey: string) =>
  `${ts(teamspace)}/ask-sites/${seg(siteKey)}`;

function need<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null || value === "") throw new ToolError(message);
  return value;
}

function confirmed(confirm: string | undefined, expected: string, what: string): void {
  if (!expected) throw new ToolError(`Could not read ${what} from the API. Nothing was deleted.`);
  if (confirm !== expected) {
    throw new ToolError(
      `Refused: \`confirm\` does not match ${what}. Ask the user to confirm this deletion. Then call again with \`confirm\` set to ${what}.`
    );
  }
}

/** `data` of a `{ data }` envelope, else the body itself. */
function data(body: unknown): Record<string, unknown> {
  const value =
    body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * The library a rule belongs to, or null for a teamspace rule: as given, else
 * looked up in the rule list, since the API finds a library rule only by both ids.
 */
async function ruleLibrary(
  api: Api,
  base: string,
  ruleId: string,
  given: string | undefined
): Promise<string | null> {
  if (given) return normalizeLibraryId(given);
  const { libraries = {} } = data(await api.get(base)) as {
    libraries?: Record<string, Record<string, unknown>>;
  };
  return Object.keys(libraries).find((library) => ruleId in libraries[library]) ?? null;
}

/** The filter mode a library request's list works in: allow lists are `select`, the rest `quality`. */
function requestMode(requestType: unknown): "select" | "quality" {
  return requestType === "allow" || requestType === "unallow" ? "select" : "quality";
}

/** The email of the member with this id, from `GET /members` (`{ members, invitations }`). */
function memberEmail(body: unknown, memberId: string): string | undefined {
  const { members } = (body ?? {}) as { members?: { id?: unknown; email?: unknown }[] };
  const email = members?.find((member) => member.id === memberId)?.email;
  return typeof email === "string" ? email : undefined;
}

const libraryId = z
  .string()
  .describe('Library id, such as "/owner/repo" (from list_libraries). "owner/repo" also works.');
const siteId = z.string().describe("Docs7 site id (from docs7_list_sites).");
const siteKey = z.string().describe("Ask site key, such as ask_… (from ask_list_sites).");
const ASK_TOP = 20;
const askDays = z.union([z.literal(1), z.literal(7), z.literal(30)]).optional();

const SOURCE_TYPE = z.enum([
  "public_repos",
  "private_sources",
  "confluence",
  "notion",
  "uploaded_files",
  "websites",
  "llmstxt",
]);
const LIST_OPERATION = z.union([
  z.object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() }),
  z.object({ clear: z.literal(true) }),
]);

const SITE_REPORTS = {
  visitors: "humans",
  ai_crawlers: "ai-crawlers",
  top_ai_paths: "top-paths",
  ai_requests: "recent-requests",
  queries: "queries",
  feedback: "feedback",
} as const;

export const TOOLS: ToolDef[] = [
  // ---------- account ----------
  tool({
    name: "list_teamspaces",
    title: "List teamspaces",
    description:
      "List the teamspaces of the user, with role and plan. Call this first to get the `teamspace` id that the other tools take.",
    kind: "read",
    teamspace: false,
    args: {},
    run: (_args, api) => api.get("/v2/teamspaces"),
  }),
  tool({
    name: "get_teamspace",
    title: "Get teamspace",
    description:
      "Get one teamspace: name, your role, owner plan, billing model, Docs7 Pro, and the monthly spending cap with this month's spend.",
    kind: "read",
    args: {},
    run: async ({ teamspace }, api) => {
      const [details, spendingLimit] = await Promise.all([
        api.get(ts(teamspace)),
        api.get(`${ts(teamspace)}/spending-limit`),
      ]);
      return { teamspace: details, spendingLimit };
    },
  }),
  tool({
    name: "manage_members",
    title: "Manage members",
    description:
      "List members and pending invitations, invite a member, change a role, remove a member, or cancel an invitation. Only an owner or admin can make changes. `remove` needs `confirm` set to the member's email, after the user confirms.",
    actions: {
      list: "read",
      invite: "write",
      update_role: "write",
      remove: "destructive",
      cancel_invitation: "write",
    },
    args: {
      email: z.string().optional().describe("Email to invite (invite)."),
      role: z.enum(["admin", "developer"]).optional().describe("Role (invite, update_role)."),
      member_id: z.string().optional().describe("Member id from list (update_role, remove)."),
      invitation_id: z.string().optional().describe("Invitation id from list (cancel_invitation)."),
      confirm: z
        .string()
        .optional()
        .describe("The member's email, after the user confirms the removal (remove)."),
    },
    run: async (args, api) => {
      const base = ts(args.teamspace);
      switch (args.action) {
        case "list":
          return api.get(`${base}/members`);
        case "invite":
          return api.post(`${base}/members`, {
            email: need(args.email, "`email` is required to invite."),
            role: need(args.role, "`role` is required to invite."),
          });
        case "update_role":
          return api.patch(
            `${base}/members/${seg(need(args.member_id, "`member_id` is required."))}`,
            { role: need(args.role, "`role` is required.") }
          );
        case "remove": {
          const id = need(args.member_id, "`member_id` is required.");
          const email = memberEmail(await api.get(`${base}/members`), id);
          if (!email) throw new ToolError(`No member with id "${id}". Call action list first.`);
          confirmed(args.confirm, email, "the member's email");
          return api.del(`${base}/members/${seg(id)}`);
        }
        default:
          return api.del(
            `${base}/invitations/${seg(need(args.invitation_id, "`invitation_id` is required."))}`
          );
      }
    },
  }),

  // ---------- libraries ----------
  tool({
    name: "list_libraries",
    title: "List libraries",
    description: "List the private and owned libraries of the teamspace, with their parse state.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/libraries`),
  }),
  tool({
    name: "get_library",
    title: "Get library",
    description:
      "Get one library: parse state (processing, finalizing, complete, error), the active task's progress, versions, token and snippet counts, and its benchmark score (0 to 100). After add_library, refresh_library or manage_library_versions, call it with `wait: true` until the state is complete or error.",
    kind: "read",
    args: { library_id: libraryId, wait },
    run: ({ teamspace, library_id, wait }, api) => {
      const path = lib(teamspace, library_id);
      return wait
        ? poll(
            () => api.get(path),
            (value) => ["complete", "error"].includes(stateOf(value, "state") as string)
          )
        : api.get(path);
    },
  }),
  tool({
    name: "add_library",
    title: "Add library",
    description:
      "Add a library to the teamspace from a repository, website, llms.txt or OpenAPI URL. The parse takes minutes: then call get_library with the library id from the answer and `wait: true`. A private repository needs the GitHub, GitLab or Bitbucket account connected in the dashboard. Confluence, Notion and file uploads are added in the dashboard.",
    kind: "write",
    args: {
      source: z
        .enum(["github", "gitlab", "bitbucket", "git", "website", "llmstxt", "openapi"])
        .describe("`git` is any other Git host."),
      url: z.string().describe("Repository, documentation website, llms.txt or OpenAPI spec URL."),
      private: z
        .boolean()
        .optional()
        .describe("Add a repository as a private source (owner or admin, paid plan)."),
      website_base_url: z
        .string()
        .optional()
        .describe("Websites only: crawl only pages under this URL."),
      generate_docs: z
        .boolean()
        .optional()
        .describe("Private repositories only: generate docs from the source code."),
    },
    run: ({ teamspace, source, url, private: isPrivate, website_base_url, generate_docs }, api) =>
      api.post(`${ts(teamspace)}/libraries`, {
        source,
        [ADD_URL_FIELDS[source]!]: url,
        private: isPrivate,
        websiteBaseUrl: website_base_url,
        generateDocs: generate_docs,
      }),
  }),
  tool({
    name: "refresh_library",
    title: "Refresh library",
    description:
      "Start a refresh of a library (the daily refresh limit applies). Then call get_library with `wait: true`.",
    kind: "write",
    args: { library_id: libraryId },
    run: ({ teamspace, library_id }, api) => api.post(`${lib(teamspace, library_id)}/refresh`),
  }),
  tool({
    name: "update_library_config",
    title: "Update library config",
    description:
      "Change the settings of a library the teamspace owns. Send only the fields to change. A new title or description of a public library is reviewed before it shows. Returns the saved config. Refresh the library to apply parse settings.",
    kind: "write",
    idempotent: true,
    args: {
      library_id: libraryId,
      title: z.string().max(100).optional(),
      description: z.string().max(500).optional(),
      branch: z.string().max(100).optional().describe("Branch to parse (repositories)."),
      folders: z.array(z.string()).max(50).optional().describe("Parse only these folders."),
      exclude_folders: z.array(z.string()).max(50).optional(),
      exclude_files: z.array(z.string()).max(100).optional(),
      rules: z
        .array(z.string().max(255))
        .max(50)
        .optional()
        .describe("Rules shown to agents with this library's docs."),
      base_url: z.string().optional().describe("Websites: the base URL to crawl."),
      web_url: z.string().optional().describe("Link shown on the library page."),
      exclude_urls: z
        .array(z.string())
        .max(100)
        .optional()
        .describe("Websites: URLs not to crawl."),
      use_query_params: z.boolean().optional().describe("Websites: keep query parameters."),
      keep_version_specific_pages: z
        .boolean()
        .optional()
        .describe("Keep pages that look specific to one version."),
      stop_indexing: z.boolean().optional().describe("Stop indexing the library."),
      config_source: z
        .enum(["dashboard", "context7json"])
        .optional()
        .describe("Read settings from these fields, or from the repository's context7.json."),
    },
    run: ({ teamspace, library_id, ...fields }, api) =>
      api.patch(lib(teamspace, library_id), {
        projectTitle: fields.title,
        description: fields.description,
        branch: fields.branch,
        folders: fields.folders,
        excludeFolders: fields.exclude_folders,
        excludeFiles: fields.exclude_files,
        rules: fields.rules,
        baseUrl: fields.base_url,
        webUrl: fields.web_url,
        excludeUrls: fields.exclude_urls,
        useQueryParams: fields.use_query_params,
        skipClaudeVersionExclusion: fields.keep_version_specific_pages,
        disallow: fields.stop_indexing,
        configSource: fields.config_source,
      }),
  }),
  tool({
    name: "manage_library_versions",
    title: "Manage library versions",
    description:
      "Add or remove a version (a tag or branch) of a library. After `add`, call get_library with `wait: true`. `remove` needs `confirm` set to the version name, after the user confirms.",
    actions: { add: "write", remove: "destructive" },
    args: {
      library_id: libraryId,
      version: z.string().describe("Tag or branch name."),
      is_branch: z
        .boolean()
        .optional()
        .describe(
          "`version` is a branch, not a tag (add). For remove, set it when a tag and a branch share the name."
        ),
      confirm: z
        .string()
        .optional()
        .describe("The version name, after the user confirms the removal (remove)."),
    },
    run: ({ teamspace, action, library_id, version, is_branch, confirm }, api) => {
      const base = `${lib(teamspace, library_id)}/versions`;
      if (action === "add") return api.post(base, { version, isBranch: is_branch });
      confirmed(confirm, version, "the version name");
      return api.del(`${base}/${seg(version)}`, { query: { isBranch: is_branch } });
    },
  }),
  tool({
    name: "claim_library",
    title: "Claim library",
    description:
      "Claim ownership of a library for the teamspace. Without `verify`, get the context7.json content and where it goes: for a repository, commit it to the repository root on the default branch and push; for a website, llms.txt or OpenAPI library, host it under the returned `hostUnder` URL. Then call again with `verify: true`.",
    kind: "write",
    idempotent: true,
    args: {
      library_id: libraryId,
      verify: z.boolean().optional().describe("true after context7.json is published."),
      context7_json_url: z
        .string()
        .optional()
        .describe(
          "Where context7.json is hosted (verify). Required for websites, llms.txt and OpenAPI, and for repositories off GitHub, GitLab and Bitbucket."
        ),
    },
    run: ({ teamspace, library_id, verify, context7_json_url }, api) => {
      const path = `${lib(teamspace, library_id)}/claim`;
      return verify
        ? api.post(path, context7_json_url ? { context7JsonUrl: context7_json_url } : {})
        : api.get(path);
    },
  }),
  tool({
    name: "remove_library",
    title: "Remove library",
    description:
      "Remove a private library, or give up ownership of a claimed library. Ask the user to confirm first, then set `confirm` to the library id.",
    kind: "destructive",
    args: {
      library_id: libraryId,
      confirm: z.string().describe("The library id, after the user confirms."),
    },
    run: ({ teamspace, library_id, confirm }, api) => {
      const id = normalizeLibraryId(library_id);
      // "owner/repo" and "/Owner/Repo" confirm the same library as "/owner/repo".
      const said = confirm.trim().replace(/^\/?/, "/").toLowerCase();
      confirmed(said, id, "the library id");
      return api.del(lib(teamspace, library_id));
    },
  }),
  tool({
    name: "get_library_analytics",
    title: "Get library analytics",
    description:
      "Get usage analytics of a library the teamspace owns: calls, topics, countries or clients.",
    kind: "read",
    untrusted: true,
    args: {
      library_id: libraryId,
      report: z.enum(["usage", "topics", "countries", "clients"]),
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Window in days (usage and clients only). Default 30."),
    },
    run: ({ teamspace, library_id, report, days }, api) =>
      api.get(`${lib(teamspace, library_id)}/analytics`, { report, days }),
  }),
  tool({
    name: "get_library_suggestions",
    title: "Get library suggestions",
    description:
      "Get the suggestions for a library the teamspace owns: questions its docs answered badly in Context7's benchmark, with what to add and the doc files to change. Use them to improve the docs in the repository. For a Docs7 site, its library id is in docs7_get_site.",
    kind: "read",
    untrusted: true,
    args: { library_id: libraryId },
    run: ({ teamspace, library_id }, api) => api.get(`${lib(teamspace, library_id)}/suggestions`),
  }),
  tool({
    name: "get_library_benchmarks",
    title: "Get library benchmarks",
    description:
      "Get the benchmark of a library the teamspace owns: score statistics and the graded questions (real questions asked about the library, each with the score its docs earned and the grader's explanation). Lowest scores first by default: these are the questions the docs fail. get_library_suggestions gives the fixes Context7 proposes for them.",
    kind: "read",
    untrusted: true,
    args: {
      library_id: libraryId,
      order: z.enum(["lowest", "newest"]).optional().describe("Default lowest."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Questions to return. Default 20."),
    },
    run: async ({ teamspace, library_id, order = "lowest", limit = 20 }, api) => {
      const { stats, benchmarks = [] } = (await api.get(
        `${lib(teamspace, library_id)}/benchmarks`
      )) as { stats?: unknown; benchmarks?: { score: number }[] };
      const sorted =
        order === "lowest" ? [...benchmarks].sort((a, b) => a.score - b.score) : benchmarks;
      return { stats, benchmarks: sorted.slice(0, limit) };
    },
  }),

  // ---------- rules and policies ----------
  tool({
    name: "manage_rules",
    title: "Manage rules",
    description:
      "List, create, update or delete the rules that Context7 adds to answers, for the whole teamspace or for one library. `list` gives all rules: `global` (teamspace rules) and `libraries` (rules by library id), each keyed by rule id. Changes need a paid plan. `delete` needs `confirm` set to the rule id, after the user confirms.",
    actions: { list: "read", create: "write", update: "write", delete: "destructive" },
    args: {
      rule_id: z.string().optional().describe("Rule id from list (update, delete)."),
      text: z.string().max(1000).optional().describe("Rule text (create, update)."),
      library_id: z
        .string()
        .optional()
        .describe(
          "Library id of a library rule (create). Leave out for a teamspace rule. Update and delete find the rule's library from `rule_id`."
        ),
      confirm: z
        .string()
        .optional()
        .describe("The rule id, after the user confirms the deletion (delete)."),
    },
    // The rules routes answer { success, data }; the other tools answer the data itself.
    run: async (args, api) => {
      const base = `${ts(args.teamspace)}/rules`;
      const ruleId = () => seg(need(args.rule_id, "`rule_id` is required."));
      switch (args.action) {
        case "list":
          return data(await api.get(base));
        case "create":
          return data(
            await api.post(base, {
              text: need(args.text, "`text` is required."),
              libraryId: args.library_id ? normalizeLibraryId(args.library_id) : null,
            })
          );
        case "update":
          return data(
            await api.patch(`${base}/${ruleId()}`, {
              text: need(args.text, "`text` is required."),
              libraryId: await ruleLibrary(api, base, args.rule_id!, args.library_id),
            })
          );
        default: {
          confirmed(args.confirm, need(args.rule_id, "`rule_id` is required."), "the rule id");
          const libraryId = await ruleLibrary(api, base, args.rule_id!, args.library_id);
          return data(
            await api.del(`${base}/${ruleId()}`, { query: { libraryId: libraryId ?? undefined } })
          );
        }
      }
    },
  }),
  tool({
    name: "get_library_policies",
    title: "Get policies",
    description: "Get the library filters (policies) of the teamspace.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/policies`),
  }),
  tool({
    name: "update_library_policies",
    title: "Update policies",
    description:
      'Change which libraries the teamspace can use (owner or admin). Send changes as operations, not the get_library_policies shape. Each list takes { add: [...] }, { remove: [...] } or { clear: true }; library entries are "/org/repo", "/org" or a domain. Use `dry_run: true` first to see how many libraries the change leaves.',
    kind: "write",
    idempotent: true,
    args: {
      source_types: z
        .object({
          enable: z.array(SOURCE_TYPE).optional(),
          disable: z.array(SOURCE_TYPE).optional(),
        })
        .optional(),
      library_filters: z
        .object({
          mode: z
            .enum(["quality", "select"])
            .nullable()
            .optional()
            .describe(
              "quality: filter by the rules below; select: only allowed libraries; null: off."
            ),
          quality: z
            .object({
              requireVerified: z.boolean().optional(),
              minTrustScore: z.number().int().min(0).max(10).nullable().optional(),
              maxAgeDays: z.number().int().min(1).nullable().optional(),
              blockedLibraries: LIST_OPERATION.optional(),
              exceptedLibraries: LIST_OPERATION.optional(),
              repoFilters: z
                .object({
                  minStars: z.number().int().min(0).nullable().optional(),
                  allowedLicenses: LIST_OPERATION.optional(),
                })
                .optional(),
              websiteFilters: z
                .object({
                  minBacklinks: z.number().int().min(0).nullable().optional(),
                  minReferringDomains: z.number().int().min(0).nullable().optional(),
                  minOrganicTraffic: z.number().int().min(0).nullable().optional(),
                })
                .optional(),
            })
            .optional(),
          select: z.object({ allowedLibraries: LIST_OPERATION.optional() }).optional(),
        })
        .optional(),
      dry_run: z.boolean().optional().describe("Preview the change and its library count."),
    },
    run: async ({ teamspace, source_types, library_filters, dry_run }, api) => {
      if (!source_types && !library_filters) {
        throw new ToolError("Send `source_types` or `library_filters`.");
      }
      const result = (await api.patch(`${ts(teamspace)}/policies`, {
        sourceTypes: source_types,
        libraryFilters: library_filters,
        dryRun: dry_run,
      })) as { libraryFilters?: { mode?: unknown } } | null;
      if ((library_filters?.quality || library_filters?.select) && !result?.libraryFilters?.mode) {
        return {
          ...result,
          note: 'Library filters are off (mode is null): the saved rules have no effect until `library_filters.mode` is "quality" or "select".',
        };
      }
      return result;
    },
  }),
  tool({
    name: "manage_library_requests",
    title: "Manage library requests",
    description:
      "List, create, approve or dismiss requests from members to allow or block a library.",
    actions: { list: "read", request: "write", approve: "write", dismiss: "write" },
    args: {
      library: z
        .string()
        .optional()
        .describe(
          'Library such as "/org/repo" or "/org", or a domain such as "stripe.com" (request).'
        ),
      request_type: z
        .enum(["allow", "block", "unallow", "unblock", "except", "unexcept"])
        .optional()
        .describe("What to request (request)."),
      request_id: z.string().optional().describe("Request id from list (approve, dismiss)."),
    },
    run: async (args, api) => {
      const base = `${ts(args.teamspace)}/library-requests`;
      const requestId = () => seg(need(args.request_id, "`request_id` is required."));
      switch (args.action) {
        case "list":
          return api.get(base);
        case "request":
          return api.post(base, {
            libraryIdentifier: need(args.library, "`library` is required."),
            requestType: need(args.request_type, "`request_type` is required."),
          });
        case "approve": {
          // Approval edits a list, never the mode, so the mode is read first: a
          // rejected credential then stops the call before anything is written.
          const policies = (await api
            .get(`${ts(args.teamspace)}/policies`)
            .then(data)
            .catch((error: unknown) => {
              if (error instanceof Error && "status" in error && error.status === 401) throw error;
              return null;
            })) as { libraryFilters?: { mode?: unknown } } | null;
          const approved = await api.post(`${base}/${requestId()}/approve`);
          // The list applies only in its own filter mode.
          const mode = requestMode(data(approved).requestType);
          if (policies?.libraryFilters?.mode === mode) return approved;
          if (!policies) {
            return {
              ...data(approved),
              note: `Approved. Could not read the policies to check that library filters are in "${mode}" mode; the list has no effect in another mode. Check with get_library_policies, and ask the user before you change the mode.`,
            };
          }
          return {
            ...data(approved),
            note: `Saved in the policy list, but library filters are not in "${mode}" mode, so it has no effect yet. Ask the user before you call update_library_policies with \`library_filters.mode: "${mode}"\`: that mode changes which libraries the whole teamspace can use (try \`dry_run: true\` first).`,
          };
        }
        default:
          return api.del(`${base}/${requestId()}`);
      }
    },
  }),

  // ---------- usage ----------
  tool({
    name: "get_teamspace_usage",
    title: "Get usage",
    description: "Get daily usage and cost, the quota and the credit of the teamspace.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/usage`),
  }),
  tool({
    name: "set_spending_limit",
    title: "Set spending limit",
    description: "Set or remove the monthly spending cap (owner or admin).",
    kind: "write",
    idempotent: true,
    args: {
      limit_cents: z
        .number()
        .int()
        .min(0)
        .max(10_000_000)
        .nullable()
        .describe("Monthly cap in US cents, up to 10,000,000. null removes the cap."),
    },
    run: ({ teamspace, limit_cents }, api) =>
      api.put(`${ts(teamspace)}/spending-limit`, { limitCents: limit_cents }),
  }),

  // ---------- docs7 ----------
  tool({
    name: "docs7_list_sites",
    title: "List Docs7 sites",
    description:
      "List the Docs7 sites of the teamspace: GitHub sites in `sites`, sites deployed from the CLI in `cliSites`, with their address and agent settings. docs7_get_site gives every setting of one site.",
    kind: "read",
    args: {},
    run: async ({ teamspace }, api) => {
      const body = (await api.get(`${ts(teamspace)}/sites`)) as {
        data?: Record<string, unknown>[];
        localSites?: Record<string, unknown>[];
      };
      return {
        sites: (body.data ?? []).map(siteSummary),
        cliSites: (body.localSites ?? []).map(siteSummary),
      };
    },
  }),
  tool({
    name: "docs7_get_site",
    title: "Get Docs7 site",
    description:
      "Get one Docs7 site: settings, custom domain, agent settings and, for a GitHub site, agent usage: the plan, whether this month's agent runs are used up, and this UTC month's runs, failed runs and pull request states by agent.",
    kind: "read",
    args: { site_id: siteId },
    run: async ({ teamspace, site_id }, api) => {
      const path = site(teamspace, site_id);
      const details = data(await api.get(path));
      // A CLI site has no agent, and its agent-usage route answers 404.
      if (details.source === "local") return { site: siteDetails(details) };
      const readHistory = async (history: AgentHistory) =>
        (
          (await api.get(`${path}/agent-runs`, { history, limit: AGENT_HISTORY_LIMIT })) as {
            data?: AgentRun[];
          }
        )?.data ?? [];
      const [usage, improve, review, watch] = await Promise.all([
        api.get(`${path}/agent-usage`),
        readHistory("improve"),
        readHistory("review"),
        readHistory("watch"),
      ]);
      const activity = agentActivity({ improve, review, watch });
      return { site: siteDetails(details), agentUsage: { ...data(usage), ...activity } };
    },
  }),
  tool({
    name: "docs7_create_site",
    title: "Create Docs7 site",
    description:
      "Add a Docs7 site from a GitHub repository. The Docs7 GitHub app must be installed on the repository (the user does this in the dashboard). A repository without docs.json or mint.json becomes an agent-only site, which is not published. Gives the site and the first build's `deploymentId` (null when no build started): call docs7_get_deployment with it and `wait: true`.",
    kind: "write",
    args: {
      repo_url: z.string().describe("https://github.com/owner/repo"),
      docs_path: z
        .string()
        .describe('Relative path of the docs folder, such as "docs", or "." for the root.'),
      branch: z.string().optional().describe("Branch to build. Default: the repository default."),
      slug: z
        .string()
        .optional()
        .describe("First label of the <slug>.docs7.io hostname. Owner or admin only."),
      custom_domain: z.string().optional().describe("Owner or admin only. Needs routing."),
      custom_domain_path: z
        .string()
        .optional()
        .describe("Path on the custom domain. Required for proxy routing."),
      custom_domain_routing: z.enum(["dns", "proxy"]).optional(),
      context7_index: z.boolean().optional().describe("Also index the site in Context7."),
    },
    run: async (args, api) => {
      const created = (await api.post(`${ts(args.teamspace)}/sites`, {
        repoUrl: args.repo_url,
        docsPath: args.docs_path,
        branch: args.branch,
        slug: args.slug,
        customDomain: args.custom_domain,
        customDomainPath: args.custom_domain_path,
        customDomainRouting: args.custom_domain_routing,
        context7Index: args.context7_index,
      })) as { data?: Record<string, unknown>; deploymentId?: unknown };
      return { site: siteDetails(data(created)), deploymentId: created?.deploymentId ?? null };
    },
  }),
  tool({
    name: "docs7_update_site",
    title: "Update Docs7 site",
    description:
      'Change a Docs7 site. Send only the fields to change. A developer can only send `hosting: "on"`, which publishes an agent-only site. After a custom domain change, call docs7_check_domain.',
    kind: "write",
    idempotent: true,
    args: {
      site_id: siteId,
      slug: z.string().optional().describe("First label of the <slug>.docs7.io hostname."),
      branch: z.string().nullable().optional().describe("Branch to build; null: the default."),
      docs_path: z.string().optional(),
      custom_domain: z.string().nullable().optional().describe("null removes the domain."),
      custom_domain_path: z.string().nullable().optional(),
      custom_domain_routing: z.enum(["dns", "proxy"]).nullable().optional(),
      hosting: z.literal("on").optional().describe("Publish an agent-only site. One-way."),
      context7_index: z.boolean().optional().describe("Keep the site's library on Context7."),
      improve_schedule: z
        .enum(["off", "daily", "weekly"])
        .optional()
        .describe("How often the Context7 Agent turns reader suggestions into a pull request."),
      build_fix_schedule: z
        .enum(["off", "after_build", "daily", "weekly"])
        .optional()
        .describe("When the Build Fix Agent fixes the issues of the latest production build."),
      analytics_url: z
        .string()
        .nullable()
        .optional()
        .describe("Docs URL of a site not hosted here."),
      pull_request_review: z
        .object({
          enabled: z.boolean(),
          response: z
            .enum(["comment", "pull_request", "commit"])
            .describe("What to do with fixes; the findings comment is always posted."),
        })
        .optional()
        .describe("PR Review Agent settings. Every check always runs."),
      code_watch: z
        .object({
          enabled: z.boolean(),
          repositories: z.array(z.string()).max(50).describe("https repository URLs."),
        })
        .optional()
        .describe("All Code Watch settings: the full list of watched repositories."),
    },
    run: async ({ teamspace, site_id, ...fields }, api) => {
      const updated = await api.patch(site(teamspace, site_id), {
        slug: fields.slug,
        branch: fields.branch,
        docsPath: fields.docs_path,
        customDomain: fields.custom_domain,
        customDomainPath: fields.custom_domain_path,
        customDomainRouting: fields.custom_domain_routing,
        hosting: fields.hosting,
        context7Index: fields.context7_index,
        improveSchedule: fields.improve_schedule,
        buildFixSchedule: fields.build_fix_schedule,
        analyticsUrl: fields.analytics_url,
        pullRequestReview: fields.pull_request_review,
        codeWatch: fields.code_watch,
      });
      return { site: siteDetails(data(updated)) };
    },
  }),
  tool({
    name: "docs7_check_domain",
    title: "Check custom domain",
    description:
      "Check the custom domain of a Docs7 site again. Gives its status and the DNS records to add.",
    kind: "write",
    idempotent: true,
    args: { site_id: siteId },
    run: async ({ teamspace, site_id }, api) => {
      const checked = data(await api.post(`${site(teamspace, site_id)}/domain/refresh`));
      return {
        customDomain: checked.customDomain,
        customDomainPath: checked.customDomain ? checked.customDomainPath : undefined,
        routing: checked.customDomainRouting,
        status: checked.customDomainStatus,
        records: checked.customDomainRecords,
      };
    },
  }),
  tool({
    name: "docs7_list_deployments",
    title: "List deployments",
    description:
      "List the builds of a Docs7 site, newest first, and its preview targets. Works for GitHub and CLI sites.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      page: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Zero-based page (GitHub sites). Default 0."),
    },
    run: async ({ teamspace, site_id, page }, api) => {
      const path = site(teamspace, site_id);
      // A CLI site keeps its builds apart; its /deployments route answers 404.
      const body = (await isCliSite(api, path))
        ? await api.get(`${path}/local-deployments`)
        : await api.get(`${path}/deployments`, { page });
      const { data: rows, ...rest } = without(body, DEPLOYMENT_NOISE) as { data?: unknown };
      // A GitHub site answers { data: [...] }, a CLI site { data: { deployments, targets } }.
      if (Array.isArray(rows)) return { data: rows.map(deploymentView), ...rest };
      const cli = rows as { deployments?: unknown[] } | undefined;
      return {
        data: cli?.deployments
          ? { ...cli, deployments: cli.deployments.map(deploymentView) }
          : rows,
        ...rest,
      };
    },
  }),
  tool({
    name: "docs7_get_deployment",
    title: "Get deployment",
    description:
      'Get one build of a Docs7 site (queued, building, succeeded, failed or canceled). After docs7_deploy, call it with `wait: true` until it ends. For a failed build, add `include: ["health", "logs"]` (CLI sites have logs only).',
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      deployment_id: z.string(),
      include: z.array(z.enum(["logs", "health", "origin"])).optional(),
      wait,
    },
    run: async ({ teamspace, site_id, deployment_id, include: requested = [], wait }, api) => {
      const include = [...new Set(requested)];
      const sitePath = site(teamspace, site_id);
      const path = `${sitePath}/deployments/${seg(deployment_id)}`;
      const cli = await isCliSite(api, sitePath);
      if (cli && include.some((part) => part !== "logs")) {
        throw new ToolError('A CLI site has build logs only. Use `include: ["logs"]`.');
      }
      const once = cli
        ? async () => {
            const { deployments = [] } = data(await api.get(`${sitePath}/local-deployments`)) as {
              deployments?: { id?: unknown }[];
            };
            const found = deployments.find((deployment) => deployment.id === deployment_id);
            if (!found)
              throw new ToolError(`No build "${deployment_id}". Call docs7_list_deployments.`);
            return { data: found };
          }
        : () => api.get(path);
      const deployment = wait
        ? await poll(once, (value) =>
            ["succeeded", "failed", "canceled"].includes(stateOf(value, "state") as string)
          )
        : await once();
      const parts = await Promise.all(include.map((part) => api.get(`${path}/${part}`)));
      return Object.fromEntries([
        ["deployment", deploymentView(data(deployment))],
        ...include.map((part, index) => [part, parts[index]]),
      ]);
    },
  }),
  tool({
    name: "docs7_deploy",
    title: "Deploy Docs7 site",
    description:
      "Deploy a Docs7 site to production, or deploy a preview of a branch. Gives a deployment id: then call docs7_get_deployment with `wait: true`.",
    kind: "write",
    args: {
      site_id: siteId,
      branch: z
        .string()
        .optional()
        .describe("Deploy a preview of this branch. Leave out for production."),
    },
    run: ({ teamspace, site_id, branch }, api) =>
      api.post(
        `${site(teamspace, site_id)}/deployments`,
        branch ? { kind: "preview", branch } : { kind: "production" }
      ),
  }),
  tool({
    name: "docs7_remove_preview",
    title: "Remove preview",
    description:
      "Remove the preview of a branch from a Docs7 site. Ask the user to confirm first, then set `confirm` to the branch name.",
    kind: "destructive",
    args: {
      site_id: siteId,
      branch: z.string(),
      confirm: z.string().describe("The branch name, after the user confirms."),
    },
    run: ({ teamspace, site_id, branch, confirm }, api) => {
      confirmed(confirm, branch, "the branch name");
      return api.del(`${site(teamspace, site_id)}/previews`, { query: { branch } });
    },
  }),
  tool({
    name: "docs7_get_agent_runs",
    title: "Get agent runs",
    description:
      "Get the agent run history of a Docs7 site, newest first: `improve` (Context7 Agent and Build Fix Agent), `review` (PR Review Agent) or `watch` (Code Watch Agent). Each run has its state (running, completed, failed or superseded) and its pull request. The agents run on their schedules (docs7_update_site); this server does not start them.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      history: z.enum(["improve", "review", "watch"]).optional().describe("Default improve."),
      limit: z.number().int().min(1).max(50).optional().describe("Newest n runs."),
    },
    run: async ({ teamspace, site_id, history, limit }, api) => {
      const body = (await api.get(`${site(teamspace, site_id)}/agent-runs`, {
        history,
        limit,
      })) as {
        data?: Record<string, unknown>[];
      };
      return { data: (body?.data ?? []).map(runView) };
    },
  }),
  tool({
    name: "docs7_manage_feature_requests",
    title: "Manage feature requests",
    description:
      "List the feature requests readers and agents left on a Docs7 site, mark one shipped (with the page that answers it), or reopen it.",
    actions: { list: "read", ship: "write", reopen: "write" },
    untrusted: true,
    args: {
      site_id: siteId,
      feature_request_id: z.string().optional().describe("Feature request id (ship, reopen)."),
      docs_url: z.string().optional().describe("https page that answers the request (ship)."),
    },
    run: (args, api) => {
      const base = `${site(args.teamspace, args.site_id)}/feature-requests`;
      if (args.action === "list") return api.get(base);
      const id = need(args.feature_request_id, "`feature_request_id` is required.");
      return args.action === "ship"
        ? api.patch(base, { id, status: "shipped", docsUrl: args.docs_url ?? null })
        : api.patch(base, { id, status: "requested" });
    },
  }),
  tool({
    name: "docs7_get_analytics",
    title: "Get site analytics",
    description:
      "Get one analytics report of a Docs7 site. `queries` and `feedback` show what readers searched for and asked, so you can find doc gaps.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      report: z.enum(
        Object.keys(SITE_REPORTS) as [keyof typeof SITE_REPORTS, ...(keyof typeof SITE_REPORTS)[]]
      ),
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Window in days, within the plan's history. Default 7."),
      previews: z.boolean().optional().describe("Include branch preview traffic."),
    },
    run: ({ teamspace, site_id, report, days, previews }, api) =>
      api.get(`${site(teamspace, site_id)}/analytics/${SITE_REPORTS[report]}`, {
        days,
        previews: previews ? "1" : undefined,
      }),
  }),
  tool({
    name: "docs7_query_logs",
    title: "Query site logs",
    description:
      "Search the records of a Docs7 site: reader searches, assistant questions, AI requests or page views.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      dataset: z.enum(["searches", "questions", "ai-requests", "page-views"]),
      days: z.number().int().min(1).max(90).optional().describe("Window in days. Default 7."),
      search: z.string().max(512).optional(),
      filters: z
        .array(
          z.object({
            field: z.string(),
            operator: z.enum([
              "eq",
              "neq",
              "contains",
              "notContains",
              "startsWith",
              "gt",
              "gte",
              "lt",
              "lte",
            ]),
            value: z.union([z.string(), z.number(), z.boolean()]),
          })
        )
        .max(8)
        .optional()
        .describe(
          "AND rules. Text fields (eq, neq, contains, notContains, startsWith): searches: query, path, source, language, version, country, host; questions: query, category, path, country, host; ai-requests: company, path, country, host, method; page-views: path, referrer, country, browser, os, device, host. Number field `turn` (questions; eq, neq, gt, gte, lt, lte). Boolean fields (eq only): `found` (searches), `verified` (ai-requests)."
        ),
      group_by: z
        .string()
        .optional()
        .describe(
          "Field to group by. searches: query, path, source, country; questions: query, category, path, country; ai-requests: company, path, country, verified; page-views: path, referrer, country, device, browser, os."
        ),
      order: z.enum(["newest", "oldest"]).optional(),
      page: z.number().int().min(1).optional(),
      previews: z.boolean().optional(),
    },
    run: async (args, api) => {
      const to = new Date();
      const from = new Date(to.getTime() - (args.days ?? 7) * 86_400_000);
      const body = (await api.post(`${site(args.teamspace, args.site_id)}/analytics/explore`, {
        previews: args.previews ?? false,
        query: {
          dataset: args.dataset,
          from: from.toISOString(),
          to: to.toISOString(),
          search: args.search ?? "",
          filters: args.filters ?? [],
          groupBy: args.group_by ?? null,
          order: args.order ?? "newest",
          page: args.page ?? 1,
        },
      })) as { data?: { series?: { group?: string | null }[] } };
      // A grouped series charts the top groups; its null group sums all the others.
      if (args.group_by) {
        for (const point of body?.data?.series ?? []) point.group ??= "other";
      }
      return body;
    },
  }),
  tool({
    name: "docs7_get_conversation",
    title: "Get conversation",
    description:
      "Get one recorded assistant conversation of a Docs7 site (`conversationId` of a `questions` row from docs7_query_logs).",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      conversation_id: z.string(),
      previews: z.boolean().optional(),
    },
    run: ({ teamspace, site_id, conversation_id, previews }, api) =>
      api.post(`${site(teamspace, site_id)}/analytics/conversation`, {
        conversationId: conversation_id,
        previews: previews ?? false,
      }),
  }),

  // ---------- ask ----------
  tool({
    name: "ask_list_sites",
    title: "List Ask sites",
    description: "List the Ask sites of the teamspace, with index status and limits.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/ask-sites`),
  }),
  tool({
    name: "ask_get_site",
    title: "Get Ask site",
    description:
      "Get one Ask site: verification, index status (pending, submitted, ready or failed) and the snippet to embed. After ask_verify_site, call it with `wait: true` until the index is ready or failed.",
    kind: "read",
    args: { site_key: siteKey, wait },
    run: ({ teamspace, site_key, wait }, api) => {
      const once = () => api.get(askSite(teamspace, site_key));
      return wait
        ? poll(once, (value) =>
            ["ready", "failed"].includes(stateOf(value, "indexStatus") as string)
          )
        : once();
    },
  }),
  tool({
    name: "ask_create_site",
    title: "Create Ask site",
    description:
      "Add an Ask site. Gives the meta tag (verificationTag) to put in the page <head>. Deploy the page with the tag, then call ask_verify_site.",
    kind: "write",
    args: { url: z.string().describe("Public https:// or http:// URL of the site.") },
    run: ({ teamspace, url }, api) => api.post(`${ts(teamspace)}/ask-sites`, { url }),
  }),
  tool({
    name: "ask_verify_site",
    title: "Verify Ask site",
    description:
      "Check the meta tag of an Ask site and start the crawl. Then call ask_get_site with `wait: true`.",
    kind: "write",
    idempotent: true,
    args: { site_key: siteKey },
    run: ({ teamspace, site_key }, api) => api.post(`${askSite(teamspace, site_key)}/verify`),
  }),
  tool({
    name: "ask_get_analytics",
    title: "Get Ask analytics",
    description:
      "Get the analytics of an Ask site: questions over time, clients, unanswered questions (gaps) and top questions.",
    kind: "read",
    untrusted: true,
    args: {
      site_key: siteKey,
      days: askDays.describe("Window in days. Default 30."),
    },
    run: async ({ teamspace, site_key, days }, api) => {
      const body = (await api.get(`${askSite(teamspace, site_key)}/analytics`, { days })) as {
        data?: Record<string, unknown>;
      };
      // Both lists hold every distinct question; the first ASK_TOP carry the signal.
      const report = body?.data ?? {};
      const top = (list: unknown) => (Array.isArray(list) ? list.slice(0, ASK_TOP) : list);
      return {
        data: { ...report, gaps: top(report.gaps), topQuestions: top(report.topQuestions) },
      };
    },
  }),
  tool({
    name: "ask_list_questions",
    title: "List Ask questions",
    description: "List the question log of an Ask site, or get one answer with `question_id`.",
    kind: "read",
    untrusted: true,
    args: {
      site_key: siteKey,
      question_id: z.string().optional(),
      page: z.number().int().min(0).optional().describe("Zero-based page."),
      client: z
        .enum([
          "anthropic",
          "openai",
          "perplexity",
          "cursor",
          "opencode",
          "meta",
          "mistral",
          "xai",
          "browser",
          "unknown",
        ])
        .optional()
        .describe("Only questions from this client."),
      days: askDays.describe("Window in days."),
      search: z.string().max(200).optional(),
      answer: z.enum(["answered", "no_match"]).optional(),
    },
    run: ({ teamspace, site_key, question_id, ...query }, api) => {
      const path = `${askSite(teamspace, site_key)}/questions`;
      if (question_id) return api.get(`${path}/${seg(question_id)}`);
      const { page, client, days, search, answer } = query;
      return api.get(path, { page, client, days, search, answer });
    },
  }),
];
