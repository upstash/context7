// Map of canonical arg name -> hallucinated aliases that should be rewritten
// to it. LLM clients often echo phrasing from tool descriptions instead of
// the literal schema keys, which trips Zod validation before the tool runs.
export type AliasMap = Record<string, readonly string[]>;

export const GLOBAL_ALIASES: AliasMap = {
  query: ["userQuery", "question"],
};

// Tool-scoped aliases, for keys that are canonical on one tool but a
// hallucination on another (e.g. `libraryName` is canonical for
// `resolve-library-id`, so we only rewrite it on `query-docs` calls).
export const QUERY_DOCS_ALIASES: AliasMap = {
  libraryId: ["context7CompatibleLibraryID", "libraryID", "libraryName"],
};

// z.preprocess step that rewrites aliased arg names before validation. Living
// in the schema keeps aliasing transport-agnostic: the SDK parses the wire
// message (any transport, any protocol era) and runs this on validation.
// Returns a remapped copy — the raw wire params object stays untouched.
export function aliasArgs(aliases: AliasMap) {
  return (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    const args: Record<string, unknown> = { ...value };
    for (const [canonical, alternatives] of Object.entries(aliases)) {
      if (canonical in args) continue;
      for (const alt of alternatives) {
        if (alt in args) {
          args[canonical] = args[alt];
          delete args[alt];
          break;
        }
      }
    }
    return args;
  };
}
