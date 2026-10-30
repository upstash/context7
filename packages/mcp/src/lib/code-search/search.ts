import { spawn } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { CodeSearchError, type Checkout } from "./checkout.js";
import type { CodeIndex, SymbolEntry } from "./indexer.js";
import {
  AGENT_FILE_EXCLUDES,
  describeLicense,
  sanitizeSource,
  UNTRUSTED_NOTE,
  wrapUntrusted,
} from "./safety.js";

export type SearchMode = "literal" | "regex" | "symbol";
/** `content` shows matching lines, `files` lists files with match counts, `count` gives totals. */
export type OutputMode = "content" | "files" | "count";

export interface SearchOptions {
  pattern: string;
  mode: SearchMode;
  /** Git pathspec glob that limits the search, e.g. `src/**` or `*.py`. */
  path?: string;
  maxResults: number;
  /** Number of ranked results to skip, for paging. */
  offset?: number;
}

export interface FileCount {
  path: string;
  count: number;
}

export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

const GREP_TIMEOUT_MS = 20_000;
const MAX_LINE_CHARS = 240;
const MAX_READ_LINES = 400;
const MAX_READ_CHARS = 40_000;
const DEFAULT_READ_LINES = 200;
/** Ranked results are collected up to this many, which also bounds paging. */
const MAX_COLLECT = 2_000;

const GREP_EXCLUDES = [
  ":(exclude)*.min.js",
  ":(exclude)*.min.css",
  ":(exclude)*.map",
  ":(exclude)*.lock",
  ":(exclude)*-lock.json",
  ":(exclude)*-lock.yaml",
  ":(exclude)*.snap",
  ...AGENT_FILE_EXCLUDES,
];

/** Lower is better: library code first, then tests, then docs and examples. */
function pathRank(file: string): number {
  const lower = file.toLowerCase();
  if (
    /(^|\/)(test|tests|__tests__|spec|testing|fixtures?)(\/|$)|[._-](test|spec)\.\w+$/.test(lower)
  )
    return 2;
  if (/(^|\/)(docs?|examples?|samples?|demo|benchmarks?)(\/|$)|\.(md|mdx|rst|txt)$/.test(lower))
    return 3;
  if (/(^|\/)(scripts?|tools?|\.github)(\/|$)/.test(lower)) return 4;
  return 1;
}

// A bare glob such as `*.py` searches every directory. A path with a slash,
// such as `src/lib`, stays anchored at the repository root.
function toPathspec(filter: string): string {
  const cleaned = filter.trim().replace(/^\.?\/+/, "");
  if (!/[*?[]/.test(cleaned)) return `:(literal)${cleaned}`;
  return `:(glob)${cleaned.includes("/") ? cleaned : `**/${cleaned}`}`;
}

function grepArgs(root: string, options: SearchOptions, countOnly: boolean): string[] {
  const caseInsensitive = options.pattern === options.pattern.toLowerCase();
  return [
    "-C",
    root,
    "grep",
    countOnly ? "-c" : "-n",
    "-I",
    "--no-color",
    "--full-name",
    ...(countOnly ? [] : ["--max-count", "20"]),
    options.mode === "regex" ? "-E" : "-F",
    ...(caseInsensitive ? ["-i"] : []),
    "-e",
    options.pattern,
    "--",
    ...(options.path ? [toPathspec(options.path)] : ["."]),
    ...GREP_EXCLUDES,
  ];
}

/**
 * Runs `git grep` and parses each output line with `parse`. Stops reading once
 * `limit` lines arrive.
 */
function runGrep<T>(
  args: string[],
  limit: number,
  parse: (line: string) => T | undefined
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const matches: T[] = [];
    let buffered = "";
    let stderr = "";
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
    }, GREP_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stopped) return;
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parse(line);
        if (parsed === undefined) continue;
        matches.push(parsed);
        if (matches.length >= limit) {
          stopped = true;
          child.kill();
          break;
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Exit code 1 means "no matches". Anything else without output is a bad pattern.
      if (!stopped && code !== 0 && code !== 1) {
        const reason = stderr.split("\n").find((line) => line.trim()) ?? "search failed";
        reject(new CodeSearchError(`Invalid search pattern: ${reason.replace(/^fatal:\s*/, "")}`));
        return;
      }
      resolve(matches);
    });
  });
}

export interface GrepPage {
  matches: CodeMatch[];
  /** Index of the first returned match in the ranked list. */
  offset: number;
  /** True when more ranked matches exist after this page. */
  more: boolean;
}

/** Returns one page of matching lines, with library code ranked before tests and docs. */
export async function grepCode(checkout: Checkout, options: SearchOptions): Promise<GrepPage> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  // Collect more than we show, so ranking can move library code to the top.
  const limit = Math.min(
    MAX_COLLECT,
    Math.max(options.maxResults * 10, 200, offset + options.maxResults + 1)
  );
  const matches = await runGrep(grepArgs(checkout.root, options, false), limit, (line) => {
    const match = line.match(/^(.*?):(\d+):(.*)$/);
    return match ? { path: match[1], line: Number(match[2]), text: match[3] } : undefined;
  });
  const ranked = matches
    .map((match, order) => ({ match, order }))
    .sort((a, b) => pathRank(a.match.path) - pathRank(b.match.path) || a.order - b.order)
    .map(({ match }) => match);
  return {
    matches: ranked.slice(offset, offset + options.maxResults),
    offset,
    more: ranked.length > offset + options.maxResults,
  };
}

/** Counts matching lines per file, without a per-file cap. */
export async function countMatches(
  checkout: Checkout,
  options: SearchOptions
): Promise<FileCount[]> {
  const counts = await runGrep(grepArgs(checkout.root, options, true), MAX_COLLECT, (line) => {
    const match = line.match(/^(.*):(\d+)$/);
    return match ? { path: match[1], count: Number(match[2]) } : undefined;
  });
  return counts.sort((a, b) => pathRank(a.path) - pathRank(b.path) || b.count - a.count);
}

/** Finds symbol definitions: exact name, then case-insensitive, then substring. */
export function findSymbols(index: CodeIndex, query: string, maxResults: number): SymbolEntry[] {
  // `Client.send` and `pkg::Client::send` both look up the last segment.
  const name =
    query
      .trim()
      .split(/::|\.|#/)
      .filter(Boolean)
      .pop() ?? "";
  if (!name) return [];
  const lower = name.toLowerCase();
  const tiers: SymbolEntry[][] = [[], [], []];
  for (const symbol of index.symbols) {
    if (symbol.name === name) tiers[0].push(symbol);
    else if (symbol.name.toLowerCase() === lower) tiers[1].push(symbol);
    else if (lower.length >= 3 && symbol.name.toLowerCase().includes(lower)) tiers[2].push(symbol);
  }
  const byPath = (a: SymbolEntry, b: SymbolEntry) =>
    pathRank(a.path) - pathRank(b.path) || a.path.length - b.path.length;
  return tiers.flatMap((tier) => tier.sort(byPath)).slice(0, maxResults);
}

function truncate(text: string): string {
  const trimmed = sanitizeSource(text).replace(/\s+$/, "");
  return trimmed.length > MAX_LINE_CHARS ? `${trimmed.slice(0, MAX_LINE_CHARS)}…` : trimmed;
}

/** Header with provenance: repository, ref, commit, license and how the version matched. */
export function describeCheckout(checkout: Checkout): string {
  const ref = checkout.ref === "HEAD" ? "default branch" : `tag ${checkout.ref}`;
  const lines = [
    `Repository: ${checkout.org}/${checkout.repo} at ${ref} (commit ${checkout.commit.slice(0, 12)})`,
    `Source: ${checkout.url} @ ${checkout.commit} | ${describeLicense(checkout.license)}`,
  ];
  if (checkout.ref === "HEAD") {
    lines.push("Version: none given, so this is the default branch, not a release.");
  } else if (checkout.approximateVersion) {
    lines.push(
      `Version: '${checkout.approximateVersion}' matched tag ${checkout.ref} by version prefix. Check that this tag is the release you expect.`
    );
  }
  return lines.join("\n");
}

function withBody(header: string, summary: string, body: string): string {
  return `${header}\n${summary}\n${UNTRUSTED_NOTE}\n\n${wrapUntrusted(body)}`;
}

export function formatMatches(checkout: Checkout, pattern: string, page: GrepPage): string {
  const header = describeCheckout(checkout);
  const { matches } = page;
  if (matches.length === 0) {
    if (page.offset > 0)
      return `${header}\n\nNo more matches for '${pattern}' after offset ${page.offset}.`;
    return `${header}\n\nNo matches for '${pattern}'. Try a shorter pattern, mode 'symbol', or a different path filter.`;
  }
  const groups = new Map<string, CodeMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.path) ?? [];
    list.push(match);
    groups.set(match.path, list);
  }
  const body = [...groups.entries()]
    .map(
      ([file, list]) => `${file}\n${list.map((m) => `  ${m.line}: ${truncate(m.text)}`).join("\n")}`
    )
    .join("\n\n");
  const first = page.offset + 1;
  const last = page.offset + matches.length;
  const paging = page.more ? ` More matches exist: call again with offset ${last}.` : "";
  const summary =
    `${matches.length} matches in ${groups.size} files (results ${first}-${last}).${paging}` +
    " Use 'read-library-file' with a path and line range to see more.";
  return withBody(header, summary, body);
}

export function formatCounts(
  checkout: Checkout,
  pattern: string,
  counts: FileCount[],
  output: "files" | "count",
  maxResults: number,
  offsetInput = 0
): string {
  const header = describeCheckout(checkout);
  const total = counts.reduce((sum, file) => sum + file.count, 0);
  if (counts.length === 0) return `${header}\n\nNo matches for '${pattern}'.`;
  const capped = counts.length >= MAX_COLLECT ? " (stopped counting at the file limit)" : "";
  const summary = `${total} matching lines in ${counts.length} files${capped}.`;
  if (output === "count") return `${header}\n${summary}`;

  const offset = Math.max(0, Math.floor(offsetInput));
  const shown = counts.slice(offset, offset + maxResults);
  const more =
    counts.length > offset + shown.length
      ? ` Showing files ${offset + 1}-${offset + shown.length}: call again with offset ${offset + shown.length} for more.`
      : "";
  const body = shown.map((file) => `${file.path} (${file.count})`).join("\n");
  return withBody(header, summary + more, body);
}

export function formatSymbols(checkout: Checkout, query: string, symbols: SymbolEntry[]): string {
  const header = describeCheckout(checkout);
  if (symbols.length === 0) {
    return `${header}\n\nNo definition named '${query}' was found at this version. If you expected one, it may be generated, re-exported under another name, or not exist in this version. Try mode 'literal'.`;
  }
  const body = symbols
    .map((s) => `${s.path}:${s.line} [${s.kind}] ${s.name}\n  ${truncate(s.signature)}`)
    .join("\n");
  return withBody(header, `${symbols.length} definitions for '${query}':`, body);
}

/** Normalizes a repo-relative path and rejects anything that leaves the checkout. */
export async function resolveInside(root: string, requested: string): Promise<string> {
  const cleaned = requested
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\\/g, "/");
  const candidate = path.resolve(root, cleaned || ".");
  const realRoot = await realpath(root);
  const inside = (target: string) => target === realRoot || target.startsWith(realRoot + path.sep);
  if (!inside(path.resolve(realRoot, cleaned || "."))) {
    throw new CodeSearchError(`Path '${requested}' is outside the repository.`);
  }
  let real: string;
  try {
    real = await realpath(candidate);
  } catch {
    throw new CodeSearchError(`Path '${requested}' does not exist in this repository.`);
  }
  if (!inside(real)) throw new CodeSearchError(`Path '${requested}' is outside the repository.`);
  if (path.relative(realRoot, real).split(path.sep).includes(".git")) {
    throw new CodeSearchError(`Path '${requested}' is not a source file.`);
  }
  return real;
}

function suggestPaths(index: CodeIndex, requested: string): string[] {
  const base = path.basename(requested).toLowerCase();
  if (!base) return [];
  return index.files.filter((file) => path.basename(file).toLowerCase() === base).slice(0, 5);
}

export async function readLibraryFile(
  checkout: Checkout,
  index: CodeIndex,
  requested: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  const header = describeCheckout(checkout);
  let target: string;
  try {
    target = await resolveInside(checkout.root, requested);
  } catch (error) {
    const suggestions = suggestPaths(index, requested);
    if (error instanceof CodeSearchError && suggestions.length) {
      throw new CodeSearchError(`${error.message} Did you mean: ${suggestions.join(", ")}?`);
    }
    throw error;
  }

  const relative = path
    .relative(await realpath(checkout.root), target)
    .split(path.sep)
    .join("/");
  const info = await lstat(target);
  if (info.isDirectory()) {
    const entries = (await readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".git")
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort();
    const shown = entries.slice(0, 200);
    const more = entries.length > shown.length ? `\n… ${entries.length - shown.length} more` : "";
    return `${header}\nDirectory: ${relative || "."}\n\n${sanitizeSource(shown.join("\n"))}${more}`;
  }

  const buffer = await readFile(target);
  if (buffer.includes(0)) throw new CodeSearchError(`'${relative}' is a binary file.`);
  const lines = sanitizeSource(buffer.toString("utf8")).split("\n");
  const first = Math.max(1, Math.floor(startLine ?? 1));
  if (first > lines.length) {
    throw new CodeSearchError(`'${relative}' has only ${lines.length} lines.`);
  }
  const requestedLast = Math.floor(endLine ?? first + DEFAULT_READ_LINES - 1);
  let last = Math.min(lines.length, Math.max(first, requestedLast), first + MAX_READ_LINES - 1);

  let out = "";
  let line = first;
  for (; line <= last; line++) {
    const next = `${String(line).padStart(5)}  ${lines[line - 1]}\n`;
    if (out.length + next.length > MAX_READ_CHARS) break;
    out += next;
  }
  last = line - 1;
  const rest =
    last < lines.length
      ? `\nShowing lines ${first}-${last} of ${lines.length}. Call again with startLine ${last + 1} to continue.`
      : "";
  return withBody(
    header,
    `File: ${relative} (lines ${first}-${last} of ${lines.length})${rest}`,
    out.trimEnd()
  );
}
