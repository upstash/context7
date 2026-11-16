// The /api/v2/code answers name the next call in API terms, for the MCP tool:
// `Next: read: src/a.ts#L10-L40 | more results: call again with offset 20`,
// `set fixed_strings: true`, `use operation "list"`. This rewrites those hints
// into the `ctx7 code` flags, so an agent can run the next command as it reads.
// Only the hint phrases are rewritten: code inside <library-source> frames is
// third-party text and stays exactly as the server sent it.

const FRAME_START = "<library-source>";
const FRAME_END = "</library-source>";

/** API field names in hint text, and the flags that set them. */
const FIELD_FLAGS: [RegExp, string][] = [
  [/\bcall again with offset (\d+)/g, "run again with --offset $1"],
  [/\bcall again with output_mode "count"/g, "run again with -c"],
  [/\bcall again with output_mode "files_with_matches"/g, "run again with -l"],
  [/\b[Ss]et fixed_strings: true\b/g, "add -F"],
  [/\bPass fixed_strings: true\b/g, "Add -F"],
  [/\bpass fixed_strings: true\b/g, "add -F"],
  [/\bfixed_strings: true\b/g, "-F"],
  [/\bignore_case: true\b/g, "-i"],
  [/\boperation "(grep|definition|references|outline|read|list|search)"/g, "--op $1"],
  [/\bwith path\b/g, "with --path"],
  [/\bhead_limit\b/g, "--head-limit"],
];

/** A `read: <file>#L..` hint, as the server writes it in a Next line. */
const READ_HINT = /(^|\| |Next: )read: (\S+)/g;

/** Rewrites one line of hint text. */
function hintLine(line: string, libraryId: string): string {
  let out = line.replace(READ_HINT, (_, before: string, target: string) => {
    return `${before}ctx7 code ${libraryId} --op read --path ${target}`;
  });
  for (const [pattern, flag] of FIELD_FLAGS) out = out.replace(pattern, flag);
  return out;
}

/**
 * The text of a `ctx7 code` answer or message with its hints in CLI flags. Lines
 * inside `<library-source>` frames are left as they are.
 */
export function cliCodeHints(text: string, libraryId: string): string {
  let inFrame = false;
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === FRAME_START) inFrame = true;
      if (inFrame) {
        if (trimmed === FRAME_END) inFrame = false;
        return line;
      }
      return hintLine(line, libraryId);
    })
    .join("\n");
}
