import { z } from "zod";

export const GROUPS = ["account", "libraries", "rules", "usage", "docs7", "ask"] as const;
export type Group = (typeof GROUPS)[number];

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
  group: Group;
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

function lib(teamspace: string, libraryId: string): string {
  const match = /^\/([^/]+)\/([^/]+)$/.exec(libraryId);
  if (!match) throw new ToolError('Use a library id like "/owner/repo".');
  return `${ts(teamspace)}/libraries/${seg(match[1])}/${seg(match[2])}`;
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

/** The email of the member with this id, from `GET /members` (`{ members, invitations }`). */
function memberEmail(body: unknown, memberId: string): string | undefined {
  const { members } = (body ?? {}) as { members?: { id?: unknown; email?: unknown }[] };
  const email = members?.find((member) => member.id === memberId)?.email;
  return typeof email === "string" ? email : undefined;
}

const libraryId = z.string().describe('Library id, such as "/owner/repo" (from list_libraries).');
const siteId = z.string().describe("Docs7 site id (from list_sites).");
const siteKey = z.string().describe("Ask site key, such as ask_… (from list_ask_sites).");
const askDays = z.union([z.literal(1), z.literal(7), z.literal(30)]).optional();

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
    group: "account",
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
    group: "account",
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
    group: "account",
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
    group: "libraries",
    title: "List libraries",
    description: "List the private and owned libraries of the teamspace, with their parse state.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/libraries`),
  }),
  tool({
    name: "get_library",
    group: "libraries",
    title: "Get library",
    description:
      "Get one library: parse state and progress (the active task), versions, token and snippet counts. Poll this after add_library, refresh_library or manage_library_versions until the parse is done.",
    kind: "read",
    args: { library_id: libraryId },
    run: ({ teamspace, library_id }, api) => api.get(lib(teamspace, library_id)),
  }),
  tool({
    name: "add_library",
    group: "libraries",
    title: "Add library",
    description:
      "Add a library to the teamspace. The parse takes minutes: poll get_library with the returned library id. For private GitHub, GitLab, Bitbucket, Confluence or Notion sources, the user connects the account in the dashboard first.",
    kind: "write",
    args: {
      source: z.enum([
        "github",
        "gitlab",
        "bitbucket",
        "git",
        "website",
        "llmstxt",
        "openapi",
        "confluence",
        "notion",
      ]),
      url: z
        .string()
        .optional()
        .describe(
          "Repository, website, llms.txt or OpenAPI URL. Not used for Confluence or Notion."
        ),
      options: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Other fields for the source, such as `private`, `websiteBaseUrl`, or the Confluence or Notion space and page ids."
        ),
    },
    run: ({ teamspace, source, url, options }, api) => {
      // A git token would pass through the model; private sources use the dashboard connection.
      const fields = { ...options };
      delete fields.gitToken;
      const urlField = ADD_URL_FIELDS[source];
      return api.post(`${ts(teamspace)}/libraries`, {
        ...fields,
        ...(urlField && url ? { [urlField]: url } : {}),
        source,
      });
    },
  }),
  tool({
    name: "refresh_library",
    group: "libraries",
    title: "Refresh library",
    description:
      "Start a refresh of a library (the daily refresh limit applies). Then poll get_library until the parse is done.",
    kind: "write",
    args: { library_id: libraryId },
    run: ({ teamspace, library_id }, api) => api.post(`${lib(teamspace, library_id)}/refresh`),
  }),
  tool({
    name: "update_library_config",
    group: "libraries",
    title: "Update library config",
    description:
      "Change library settings: projectTitle, description, branch, folders, excludeFolders, excludeFiles, rules, baseUrl, webUrl, excludeUrls, disallow, useQueryParams, skipClaudeVersionExclusion, configSource (dashboard or context7json). Only the teamspace that owns the library can do this. Returns the saved config.",
    kind: "write",
    idempotent: true,
    args: {
      library_id: libraryId,
      changes: z
        .record(z.string(), z.unknown())
        .describe("Only the fields to change, with the names above."),
    },
    run: ({ teamspace, library_id, changes }, api) =>
      api.patch(lib(teamspace, library_id), changes),
  }),
  tool({
    name: "manage_library_versions",
    group: "libraries",
    title: "Manage library versions",
    description:
      "Add or remove a version (a tag or branch) of a library. After `add`, poll get_library until the version is parsed. `remove` needs `confirm` set to the version name, after the user confirms.",
    actions: { add: "write", remove: "destructive" },
    args: {
      library_id: libraryId,
      version: z.string().describe("Tag or branch name."),
      is_branch: z.boolean().optional().describe("`version` is a branch, not a tag (add)."),
      confirm: z
        .string()
        .optional()
        .describe("The version name, after the user confirms the removal (remove)."),
    },
    run: ({ teamspace, action, library_id, version, is_branch, confirm }, api) => {
      const base = `${lib(teamspace, library_id)}/versions`;
      if (action === "add") return api.post(base, { version, isBranch: is_branch });
      confirmed(confirm, version, "the version name");
      return api.del(`${base}/${seg(version)}`);
    },
  }),
  tool({
    name: "claim_library",
    group: "libraries",
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
    group: "libraries",
    title: "Remove library",
    description:
      "Remove a private library, or give up ownership of a claimed library. Ask the user to confirm first, then set `confirm` to the library id.",
    kind: "destructive",
    args: {
      library_id: libraryId,
      confirm: z.string().describe("The library id, after the user confirms."),
    },
    run: ({ teamspace, library_id, confirm }, api) => {
      confirmed(confirm, library_id, "the library id");
      return api.del(lib(teamspace, library_id));
    },
  }),
  tool({
    name: "get_library_analytics",
    group: "libraries",
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

  // ---------- rules and policies ----------
  tool({
    name: "manage_rules",
    group: "rules",
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
          "Library id of a library rule (create, update, delete). Leave out for a teamspace rule."
        ),
      confirm: z
        .string()
        .optional()
        .describe("The rule id, after the user confirms the deletion (delete)."),
    },
    run: (args, api) => {
      const base = `${ts(args.teamspace)}/rules`;
      const ruleId = () => seg(need(args.rule_id, "`rule_id` is required."));
      switch (args.action) {
        case "list":
          return api.get(base);
        case "create":
          return api.post(base, {
            text: need(args.text, "`text` is required."),
            libraryId: args.library_id ?? null,
          });
        case "update":
          return api.patch(`${base}/${ruleId()}`, {
            text: need(args.text, "`text` is required."),
            libraryId: args.library_id ?? null,
          });
        default:
          confirmed(args.confirm, need(args.rule_id, "`rule_id` is required."), "the rule id");
          return api.del(`${base}/${ruleId()}`, { query: { libraryId: args.library_id } });
      }
    },
  }),
  tool({
    name: "get_policies",
    group: "rules",
    title: "Get policies",
    description: "Get the library filters (policies) of the teamspace.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/policies`),
  }),
  tool({
    name: "update_policies",
    group: "rules",
    title: "Update policies",
    description:
      "Change the library filters of the teamspace (owner or admin). Call get_policies first. Use `dry_run: true` to get the count of matching libraries without saving.",
    kind: "write",
    idempotent: true,
    args: {
      changes: z
        .record(z.string(), z.unknown())
        .describe(
          'Operations, not the get_policies shape. `sourceTypes`: { enable?, disable? } (source type keys). `libraryFilters`: { mode?: quality|select|null, quality?: { requireVerified?, minTrustScore? (0-10|null), maxAgeDays?, blockedLibraries?, exceptedLibraries?, repoFilters?: { minStars?, allowedLicenses? }, websiteFilters?: { minBacklinks?, minReferringDomains?, minOrganicTraffic? } }, select?: { allowedLibraries? } }. Each list takes { add?: [...], remove?: [...] } or { clear: true }; library entries are "/org/repo", "/org" or a domain.'
        ),
      dry_run: z.boolean().optional(),
    },
    run: ({ teamspace, changes, dry_run }, api) =>
      api.patch(`${ts(teamspace)}/policies`, { ...changes, dryRun: dry_run }),
  }),
  tool({
    name: "manage_library_requests",
    group: "rules",
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
    run: (args, api) => {
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
        case "approve":
          return api.post(`${base}/${requestId()}/approve`);
        default:
          return api.del(`${base}/${requestId()}`);
      }
    },
  }),

  // ---------- usage ----------
  tool({
    name: "get_usage",
    group: "usage",
    title: "Get usage",
    description: "Get daily usage and cost, the quota and the credit of the teamspace.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/usage`),
  }),
  tool({
    name: "set_spending_limit",
    group: "usage",
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
    name: "list_sites",
    group: "docs7",
    title: "List Docs7 sites",
    description:
      "List the Docs7 sites of the teamspace: GitHub sites in `data`, sites deployed from the CLI in `localSites`.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/sites`),
  }),
  tool({
    name: "get_site",
    group: "docs7",
    title: "Get Docs7 site",
    description:
      "Get one Docs7 site: settings, custom domain status, agent settings and, for a GitHub site, agent usage.",
    kind: "read",
    args: { site_id: siteId },
    run: async ({ teamspace, site_id }, api) => {
      const path = site(teamspace, site_id);
      const details = await api.get(path);
      // A CLI site has no agent, and its agent-usage route answers 404.
      if (data(details).source === "local") return { site: details };
      return { site: details, agentUsage: await api.get(`${path}/agent-usage`) };
    },
  }),
  tool({
    name: "create_site",
    group: "docs7",
    title: "Create Docs7 site",
    description:
      "Add a Docs7 site from a GitHub repository. The Docs7 GitHub app must be installed on the repository (the user does this in the dashboard). A repository without docs.json or mint.json becomes an agent-only site, which is not published. Gives the site and the first build's `deploymentId` (null when no build started): poll get_deployment with it.",
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
    run: (args, api) =>
      api.post(`${ts(args.teamspace)}/sites`, {
        repoUrl: args.repo_url,
        docsPath: args.docs_path,
        branch: args.branch,
        slug: args.slug,
        customDomain: args.custom_domain,
        customDomainPath: args.custom_domain_path,
        customDomainRouting: args.custom_domain_routing,
        context7Index: args.context7_index,
      }),
  }),
  tool({
    name: "update_site",
    group: "docs7",
    title: "Update Docs7 site",
    description:
      'Change a Docs7 site: slug, branch, docs path, custom domain, agent schedule, PR Review, Code Watch, or publish an agent-only site with `hosting: "on"`. After a custom domain change, call check_domain.',
    kind: "write",
    idempotent: true,
    args: {
      site_id: siteId,
      changes: z
        .object({
          slug: z.string(),
          branch: z.string().nullable(),
          docsPath: z.string(),
          customDomain: z.string().nullable(),
          customDomainPath: z.string().nullable(),
          customDomainRouting: z.enum(["dns", "proxy"]).nullable(),
          hosting: z.literal("on"),
          context7Index: z.boolean(),
          improveSchedule: z.enum(["off", "daily", "weekly"]),
          analyticsUrl: z.string().nullable(),
          pullRequestReview: z
            .object({
              enabled: z.boolean(),
              checks: z.object({
                brokenLinks: z.boolean(),
                grammar: z.boolean(),
                health: z.boolean(),
                standards: z.boolean(),
              }),
              response: z.enum(["comment", "pull_request", "commit"]),
            })
            .describe("All PR Review settings. Read the current ones with get_site."),
          codeWatch: z
            .object({
              enabled: z.boolean(),
              repositories: z.array(z.string()).max(50).describe("https repository URLs."),
            })
            .describe("All Code Watch settings: the full list of watched repositories."),
        })
        .partial()
        .describe(
          'Only the fields to change. A developer can only send { hosting: "on" }, for an agent-only site.'
        ),
    },
    run: ({ teamspace, site_id, changes }, api) => api.patch(site(teamspace, site_id), changes),
  }),
  tool({
    name: "check_domain",
    group: "docs7",
    title: "Check custom domain",
    description:
      "Check the custom domain of a Docs7 site again. Gives its status and the DNS records to add.",
    kind: "write",
    idempotent: true,
    args: { site_id: siteId },
    run: ({ teamspace, site_id }, api) => api.post(`${site(teamspace, site_id)}/domain/refresh`),
  }),
  tool({
    name: "delete_site",
    group: "docs7",
    title: "Delete Docs7 site",
    description:
      "Delete a Docs7 site and stop serving it. Ask the user to confirm first, then set `confirm` to the site slug (the first label of its docs7.io hostname).",
    kind: "destructive",
    args: {
      site_id: siteId,
      confirm: z.string().describe("The site slug, after the user confirms."),
    },
    run: async ({ teamspace, site_id, confirm }, api) => {
      const path = site(teamspace, site_id);
      const hostname = data(await api.get(path)).platformHostname;
      confirmed(confirm, typeof hostname === "string" ? hostname.split(".")[0] : "", "the slug");
      return api.del(path);
    },
  }),
  tool({
    name: "list_deployments",
    group: "docs7",
    title: "List deployments",
    description: "List the builds of a Docs7 site, newest first, and its preview targets.",
    kind: "read",
    args: {
      site_id: siteId,
      page: z.number().int().min(0).optional().describe("Zero-based page. Default 0."),
    },
    run: ({ teamspace, site_id, page }, api) =>
      api.get(`${site(teamspace, site_id)}/deployments`, { page }),
  }),
  tool({
    name: "get_deployment",
    group: "docs7",
    title: "Get deployment",
    description:
      'Get one build of a Docs7 site. Poll this after deploy_site until it finishes. For a failed build, add `include: ["health", "logs"]`.',
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      deployment_id: z.string(),
      include: z.array(z.enum(["logs", "health", "origin"])).optional(),
    },
    run: async ({ teamspace, site_id, deployment_id, include = [] }, api) => {
      const path = `${site(teamspace, site_id)}/deployments/${seg(deployment_id)}`;
      const parts = await Promise.all([
        api.get(path),
        ...include.map((part) => api.get(`${path}/${part}`)),
      ]);
      return Object.fromEntries([
        ["deployment", parts[0]],
        ...include.map((part, index) => [part, parts[index + 1]]),
      ]);
    },
  }),
  tool({
    name: "deploy_site",
    group: "docs7",
    title: "Deploy Docs7 site",
    description:
      "Deploy a Docs7 site to production, or deploy a preview of a branch. Gives a deployment id: poll get_deployment until it finishes.",
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
    name: "remove_preview",
    group: "docs7",
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
    name: "run_site_agent",
    group: "docs7",
    title: "Run Context7 Agent",
    description:
      "Start the Context7 Agent on a Docs7 site (owner or admin). `suggestions` needs `suggestion_ids` and `health` needs `issue_ids` (from manage_site_findings). `feature_requests` adds the feature requests page; `page_feedback` turns on page ratings. Then poll get_agent_runs with the returned run id.",
    kind: "write",
    args: {
      site_id: siteId,
      kind: z.enum(["suggestions", "health", "feature_requests", "page_feedback"]),
      suggestion_ids: z.array(z.string()).min(1).max(10).optional().describe("suggestions only."),
      issue_ids: z.array(z.string()).min(1).max(20).optional().describe("health only."),
    },
    run: ({ teamspace, site_id, kind, suggestion_ids, issue_ids }, api) =>
      api.post(
        `${site(teamspace, site_id)}/agent-runs`,
        kind === "suggestions"
          ? { kind, suggestionIds: need(suggestion_ids, "`suggestion_ids` is required.") }
          : kind === "health"
            ? { kind, issueIds: need(issue_ids, "`issue_ids` is required.") }
            : { kind }
      ),
  }),
  tool({
    name: "get_agent_runs",
    group: "docs7",
    title: "Get agent runs",
    description:
      "Get the agent run history of a Docs7 site (improve, review or watch), or one run with `run_id`.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      run_id: z.string().optional(),
      history: z.enum(["improve", "review", "watch"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    run: ({ teamspace, site_id, run_id, history, limit }, api) => {
      const path = `${site(teamspace, site_id)}/agent-runs`;
      return run_id ? api.get(`${path}/${seg(run_id)}`) : api.get(path, { history, limit });
    },
  }),
  tool({
    name: "manage_site_findings",
    group: "docs7",
    title: "Manage site findings",
    description:
      "List or dismiss the suggestions and build issues of a Docs7 site, and list, ship or reopen its feature requests. Pass ids to run_site_agent to fix them.",
    actions: {
      list_suggestions: "read",
      dismiss_suggestions: "destructive",
      list_build_issues: "read",
      dismiss_build_issues: "write",
      list_feature_requests: "read",
      ship_feature_request: "write",
      reopen_feature_request: "write",
    },
    untrusted: true,
    args: {
      site_id: siteId,
      ids: z
        .array(z.string())
        .max(100)
        .optional()
        .describe("Suggestion or build issue ids (dismiss)."),
      feature_request_id: z.string().optional().describe("Feature request id (ship, reopen)."),
      docs_url: z.string().optional().describe("Page that answers the request (ship)."),
    },
    run: (args, api) => {
      const base = site(args.teamspace, args.site_id);
      const ids = () => need(args.ids?.length ? args.ids : undefined, "`ids` is required.");
      const featureRequestId = () =>
        need(args.feature_request_id, "`feature_request_id` is required.");
      switch (args.action) {
        case "list_suggestions":
          return api.get(`${base}/suggestions`);
        case "dismiss_suggestions":
          return api.del(`${base}/suggestions`, { body: { suggestionIds: ids() } });
        case "list_build_issues":
          return api.get(`${base}/build-issues`);
        case "dismiss_build_issues":
          return api.del(`${base}/build-issues`, { body: { issueIds: ids() } });
        case "list_feature_requests":
          return api.get(`${base}/feature-requests`);
        case "ship_feature_request":
          return api.patch(`${base}/feature-requests`, {
            id: featureRequestId(),
            status: "shipped",
            docsUrl: args.docs_url ?? null,
          });
        default:
          return api.patch(`${base}/feature-requests`, {
            id: featureRequestId(),
            status: "requested",
          });
      }
    },
  }),
  tool({
    name: "get_site_analytics",
    group: "docs7",
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
    name: "query_site_logs",
    group: "docs7",
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
    run: (args, api) => {
      const to = new Date();
      const from = new Date(to.getTime() - (args.days ?? 7) * 86_400_000);
      return api.post(`${site(args.teamspace, args.site_id)}/analytics/explore`, {
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
      });
    },
  }),
  tool({
    name: "get_conversation",
    group: "docs7",
    title: "Get conversation",
    description:
      "Get one recorded assistant conversation of a Docs7 site (`conversationId` of a `questions` row from query_site_logs).",
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
    name: "list_ask_sites",
    group: "ask",
    title: "List Ask sites",
    description: "List the Ask sites of the teamspace, with index status and limits.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/ask-sites`),
  }),
  tool({
    name: "get_ask_site",
    group: "ask",
    title: "Get Ask site",
    description:
      "Get one Ask site: verification, index status and the snippet to embed. Poll this after verify_ask_site until the crawl is done.",
    kind: "read",
    args: { site_key: siteKey },
    run: ({ teamspace, site_key }, api) => api.get(askSite(teamspace, site_key)),
  }),
  tool({
    name: "create_ask_site",
    group: "ask",
    title: "Create Ask site",
    description:
      "Add an Ask site. Gives the meta tag (verificationTag) to put in the page <head>. Deploy the page with the tag, then call verify_ask_site.",
    kind: "write",
    args: { url: z.string().describe("Public https:// or http:// URL of the site.") },
    run: ({ teamspace, url }, api) => api.post(`${ts(teamspace)}/ask-sites`, { url }),
  }),
  tool({
    name: "verify_ask_site",
    group: "ask",
    title: "Verify Ask site",
    description:
      "Check the meta tag of an Ask site and start the crawl. Then poll get_ask_site until the crawl is done.",
    kind: "write",
    idempotent: true,
    args: { site_key: siteKey },
    run: ({ teamspace, site_key }, api) => api.post(`${askSite(teamspace, site_key)}/verify`),
  }),
  tool({
    name: "get_ask_analytics",
    group: "ask",
    title: "Get Ask analytics",
    description:
      "Get the analytics of an Ask site: questions over time, clients, unanswered questions (gaps) and top questions.",
    kind: "read",
    untrusted: true,
    args: {
      site_key: siteKey,
      days: askDays.describe("Window in days. Default 30."),
    },
    run: ({ teamspace, site_key, days }, api) =>
      api.get(`${askSite(teamspace, site_key)}/analytics`, { days }),
  }),
  tool({
    name: "list_ask_questions",
    group: "ask",
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
  tool({
    name: "delete_ask_site",
    group: "ask",
    title: "Delete Ask site",
    description:
      "Delete an Ask site, its questions and its index. Ask the user to confirm first, then set `confirm` to the site URL exactly as get_ask_site gives it.",
    kind: "destructive",
    args: {
      site_key: siteKey,
      confirm: z.string().describe("The site URL, after the user confirms."),
    },
    run: async ({ teamspace, site_key, confirm }, api) => {
      const path = askSite(teamspace, site_key);
      const url = data(await api.get(path)).url;
      confirmed(confirm, typeof url === "string" ? url : "", "the site URL");
      return api.del(path);
    },
  }),
];
