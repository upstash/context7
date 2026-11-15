// Arguments of `ctx7 code` and `ctx7 read` as agents type them. Agents bring
// ripgrep and `ctx7 docs` habits: a path after the pattern (`rg PATTERN PATH`),
// an unquoted phrase that the shell splits into words, a version written as its
// own argument, a library ID joined to a file path. A habit that has one meaning
// is accepted; one that could mean two things fails with the command to run
// instead, because a guess would search for the wrong text without saying so.

export type CodeArgs =
  | { ok: true; libraryId: string; pattern?: string; path?: string; glob?: string[] }
  | { ok: false; error: string; hint?: string };

/** A git tag or release name: `v1.36.6`, `26.8.2`, `REL_18_0`, `rust-v0.165.0`, `n8n@2.32.5`. */
export function looksLikeVersion(value: string): boolean {
  return /^(?:v?\d+(?:\.\d+)+(?:[-+.][\w.]+)?|REL_\d+(?:_\d+)*|[\w-]*-v?\d+(?:\.\d+)+[\w.-]*|[\w-]+@\d+(?:\.\d+)+)$/i.test(
    value
  );
}

/** Extensions of source and config files, so that `config.go` is a file and `Client.send` a symbol. */
const FILE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|py|pyi|go|rs|java|kt|kts|scala|swift|m|mm|c|h|cc|cpp|cxx|hpp|hh|cs|fs|rb|php|ex|exs|erl|dart|lua|zig|vue|svelte|astro|sql|proto|graphql|sh|bash|ps1|md|mdx|rst|txt|json|jsonc|ya?ml|toml|ini|cfg|conf|xml|gradle|cmake|mk|lock|env|tf|hcl|nix|gd|gdshader|glsl|wgsl)$/i;

/** A file or folder of a repository: a slash, a line range or a source file extension, and no spaces. */
export function looksLikePath(value: string): boolean {
  if (/\s/.test(value) || value.startsWith("-")) return false;
  const file = value.replace(/#L\d+(?:-L?\d+)?$/, "");
  return value.includes("/") || file !== value || FILE_EXTENSION.test(file);
}

const quote = (value: string) => `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
const HAS_REGEX = /[\\^$.|?*+()[\]{}]/;

/**
 * The library ID, pattern and paths of `ctx7 code <libraryId> [pattern] [extra...]`.
 * Extra arguments that are all paths narrow the search like `rg PATTERN PATH...`.
 */
export function codeArgs(
  libraryId: string | undefined,
  pattern: string | undefined,
  extra: string[],
  options: { library?: string; query?: string; path?: string; glob?: string[] }
): CodeArgs {
  // `--library <id>` (a docs habit): the first positional is then the pattern.
  if (options.library) {
    extra = [pattern, ...extra].filter((a): a is string => a !== undefined);
    pattern = libraryId;
    libraryId = options.library;
  }
  if (!libraryId)
    return {
      ok: false,
      error: "ctx7 code needs the library ID first.",
      hint: 'Example: ctx7 code /colinhacks/zod "safeExtend"',
    };
  // `--query` or `--search` (a docs habit) name the pattern.
  if (pattern === undefined && options.query !== undefined) pattern = options.query;
  if (!extra.length)
    return { ok: true, libraryId, pattern, path: options.path, glob: options.glob };

  // `ctx7 code /lib v1.36.6 Pattern`: the version was written as its own argument.
  if (pattern !== undefined && looksLikeVersion(pattern)) {
    const rest = extra.join(" ");
    return {
      ok: false,
      error: `"${pattern}" looks like a version, not a pattern.`,
      hint: `Add the version to the library ID: ctx7 code ${libraryId}/${pattern} ${quote(rest)}, or use --tag ${pattern}.`,
    };
  }
  if (pattern !== undefined && extra.every(looksLikePath)) {
    if (options.path && extra.length) {
      return {
        ok: false,
        error: `Both --path and the path ${quote(extra[0]!)} are given.`,
        hint: "Pass one path, or several as -g globs.",
      };
    }
    if (extra.length === 1)
      return { ok: true, libraryId, pattern, path: extra[0], glob: options.glob };
    const globs = extra.map((p) => (FILE_EXTENSION.test(p) ? p : `${p.replace(/\/+$/, "")}/**`));
    return {
      ok: true,
      libraryId,
      pattern,
      path: options.path,
      glob: [...(options.glob ?? []), ...globs],
    };
  }
  // An unquoted phrase: the shell split it into words. Its meaning is unclear (one
  // phrase, or a word and paths), so name the quoted command instead of guessing.
  const words = [pattern ?? "", ...extra];
  const phrase = words.join(" ");
  return {
    ok: false,
    error: `The pattern was split into ${words.length} arguments: ${words.map(quote).join(" ")}.`,
    hint: `Quote a pattern with spaces: ctx7 code ${libraryId} ${quote(phrase)}${HAS_REGEX.test(phrase) ? "" : " -F"}. To search in a folder, end it with / or pass --path <folder>.`,
  };
}

export type ReadArgs =
  | { ok: true; libraryId: string; path?: string; symbol?: string }
  | { ok: false; error: string; hint?: string };

/**
 * The library ID and target of `ctx7 read <libraryId> <target>`. A target copied
 * together with its library ID (`/org/repo/src/a.ts#L1-L40`, or with a version
 * segment) is split; a library ID never ends in a file name.
 */
export function readArgs(libraryId: string | undefined, target: string | undefined): ReadArgs {
  const example = "Example: ctx7 read /colinhacks/zod src/types.ts#L4613-L4660";
  if (!libraryId)
    return {
      ok: false,
      error: "ctx7 read needs a library ID and a file or symbol.",
      hint: example,
    };
  if (target === undefined) {
    const parts = libraryId.split("/").filter(Boolean);
    if (libraryId.startsWith("/") && parts.length > 2 && looksLikePath(parts.slice(2).join("/"))) {
      const versioned = parts.length > 3 && looksLikeVersion(parts[2]!);
      const idParts = parts.slice(0, versioned ? 3 : 2);
      return {
        ok: true,
        libraryId: `/${idParts.join("/")}`,
        path: parts.slice(idParts.length).join("/"),
      };
    }
    if (!libraryId.startsWith("/") && looksLikePath(libraryId))
      return {
        ok: false,
        error: `ctx7 read needs the library ID before the file "${libraryId}".`,
        hint: `Example: ctx7 read /owner/repo ${libraryId}`,
      };
    return {
      ok: false,
      error: "ctx7 read needs a file or a symbol after the library ID.",
      hint: example,
    };
  }
  return looksLikePath(target)
    ? { ok: true, libraryId, path: target }
    : { ok: true, libraryId, symbol: target };
}
