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
const askDays = z.union([z.literal(1), z.literal(7), z.literal(30)]).optional();

const SOURCE_TYPE = z.enum([
  "public_repos",
  "private_sources",
  "confluence",
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
      "Get one library: parse state (processing, finalizing, complete, error), the active task's progress, versions, token and snippet counts. After add_library, refresh_library or manage_library_versions, call it with `wait: true` until the state is complete or error.",
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
    group: "libraries",
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
    group: "libraries",
    title: "Refresh library",
    description:
      "Start a refresh of a library (the daily refresh limit applies). Then call get_library with `wait: true`.",
    kind: "write",
    args: { library_id: libraryId },
    run: ({ teamspace, library_id }, api) => api.post(`${lib(teamspace, library_id)}/refresh`),
  }),
  tool({
    name: "update_library_config",
    group: "libraries",
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
    group: "libraries",
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
      const id = normalizeLibraryId(library_id);
      // "owner/repo" and "/Owner/Repo" confirm the same library as "/owner/repo".
      const said = confirm.trim().replace(/^\/?/, "/").toLowerCase();
      confirmed(said, id, "the library id");
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
            libraryId: args.library_id ? normalizeLibraryId(args.library_id) : null,
          });
        case "update":
          return api.patch(`${base}/${ruleId()}`, {
            text: need(args.text, "`text` is required."),
            libraryId: args.library_id ? normalizeLibraryId(args.library_id) : null,
          });
        default:
          confirmed(args.confirm, need(args.rule_id, "`rule_id` is required."), "the rule id");
          return api.del(`${base}/${ruleId()}`, {
            query: { libraryId: args.library_id && normalizeLibraryId(args.library_id) },
          });
      }
    },
  }),
  tool({
    name: "get_library_policies",
    group: "rules",
    title: "Get policies",
    description: "Get the library filters (policies) of the teamspace.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/policies`),
  }),
  tool({
    name: "update_library_policies",
    group: "rules",
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
    run: ({ teamspace, source_types, library_filters, dry_run }, api) => {
      if (!source_types && !library_filters) {
        throw new ToolError("Send `source_types` or `library_filters`.");
      }
      return api.patch(`${ts(teamspace)}/policies`, {
        sourceTypes: source_types,
        libraryFilters: library_filters,
        dryRun: dry_run,
      });
    },
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
    name: "get_teamspace_usage",
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
    name: "docs7_list_sites",
    group: "docs7",
    title: "List Docs7 sites",
    description:
      "List the Docs7 sites of the teamspace: GitHub sites in `data`, sites deployed from the CLI in `localSites`.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/sites`),
  }),
  tool({
    name: "docs7_get_site",
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
    name: "docs7_create_site",
    group: "docs7",
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
    name: "docs7_update_site",
    group: "docs7",
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
        .describe("How often the Context7 Agent looks for improvements."),
      analytics_url: z
        .string()
        .nullable()
        .optional()
        .describe("Docs URL of a site not hosted here."),
      pull_request_review: z
        .object({
          enabled: z.boolean(),
          checks: z.object({
            broken_links: z.boolean(),
            grammar: z.boolean(),
            health: z.boolean(),
            standards: z.boolean(),
          }),
          response: z.enum(["comment", "pull_request", "commit"]),
        })
        .optional()
        .describe("All PR Review settings at once. Read the current ones with docs7_get_site."),
      code_watch: z
        .object({
          enabled: z.boolean(),
          repositories: z.array(z.string()).max(50).describe("https repository URLs."),
        })
        .optional()
        .describe("All Code Watch settings: the full list of watched repositories."),
    },
    run: ({ teamspace, site_id, ...fields }, api) => {
      const review = fields.pull_request_review;
      return api.patch(site(teamspace, site_id), {
        slug: fields.slug,
        branch: fields.branch,
        docsPath: fields.docs_path,
        customDomain: fields.custom_domain,
        customDomainPath: fields.custom_domain_path,
        customDomainRouting: fields.custom_domain_routing,
        hosting: fields.hosting,
        context7Index: fields.context7_index,
        improveSchedule: fields.improve_schedule,
        analyticsUrl: fields.analytics_url,
        pullRequestReview: review && {
          enabled: review.enabled,
          checks: {
            brokenLinks: review.checks.broken_links,
            grammar: review.checks.grammar,
            health: review.checks.health,
            standards: review.checks.standards,
          },
          response: review.response,
        },
        codeWatch: fields.code_watch,
      });
    },
  }),
  tool({
    name: "docs7_check_domain",
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
    name: "docs7_list_deployments",
    group: "docs7",
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
      if (await isCliSite(api, path)) return api.get(`${path}/local-deployments`);
      return api.get(`${path}/deployments`, { page });
    },
  }),
  tool({
    name: "docs7_get_deployment",
    group: "docs7",
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
        ["deployment", deployment],
        ...include.map((part, index) => [part, parts[index]]),
      ]);
    },
  }),
  tool({
    name: "docs7_deploy",
    group: "docs7",
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
    name: "docs7_run_agent",
    group: "docs7",
    title: "Run Context7 Agent",
    description:
      "Start the Context7 Agent on a Docs7 site (owner or admin). `suggestions` needs `suggestion_ids` and `health` needs `issue_ids` (from docs7_manage_findings). `feature_requests` adds the feature requests page; `page_feedback` turns on page ratings. Then call docs7_get_agent_runs with the returned run id and `wait: true`.",
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
    name: "docs7_get_agent_runs",
    group: "docs7",
    title: "Get agent runs",
    description:
      "Get the agent run history of a Docs7 site (improve, review or watch), or one run with `run_id` (running, completed, failed or superseded). A run takes minutes and ends with a pull request.",
    kind: "read",
    untrusted: true,
    args: {
      site_id: siteId,
      run_id: z.string().optional(),
      history: z.enum(["improve", "review", "watch"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      wait: wait.describe("With `run_id`: wait up to about 25 seconds for the run to end."),
    },
    run: ({ teamspace, site_id, run_id, history, limit, wait }, api) => {
      const path = `${site(teamspace, site_id)}/agent-runs`;
      if (!run_id) return api.get(path, { history, limit });
      const once = () => api.get(`${path}/${seg(run_id)}`);
      return wait
        ? poll(once, (value) =>
            ["completed", "failed", "superseded"].includes(stateOf(value, "state") as string)
          )
        : once();
    },
  }),
  tool({
    name: "docs7_manage_findings",
    group: "docs7",
    title: "Manage site findings",
    description:
      "List or dismiss the suggestions and build issues of a Docs7 site, and list, ship or reopen its feature requests. Pass ids to docs7_run_agent to fix them.",
    actions: {
      list_suggestions: "read",
      dismiss_suggestions: "destructive",
      list_build_issues: "read",
      dismiss_build_issues: "destructive",
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
    name: "docs7_get_analytics",
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
    name: "docs7_query_logs",
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
    name: "docs7_get_conversation",
    group: "docs7",
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
    group: "ask",
    title: "List Ask sites",
    description: "List the Ask sites of the teamspace, with index status and limits.",
    kind: "read",
    args: {},
    run: ({ teamspace }, api) => api.get(`${ts(teamspace)}/ask-sites`),
  }),
  tool({
    name: "ask_get_site",
    group: "ask",
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
    group: "ask",
    title: "Create Ask site",
    description:
      "Add an Ask site. Gives the meta tag (verificationTag) to put in the page <head>. Deploy the page with the tag, then call ask_verify_site.",
    kind: "write",
    args: { url: z.string().describe("Public https:// or http:// URL of the site.") },
    run: ({ teamspace, url }, api) => api.post(`${ts(teamspace)}/ask-sites`, { url }),
  }),
  tool({
    name: "ask_verify_site",
    group: "ask",
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
    name: "ask_list_questions",
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
];
