import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Checkout } from "./checkout.js";

const INDEX_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 200_000;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".gradle",
  ".idea",
  ".vscode",
]);

const SKIP_FILE =
  /(\.min\.(js|css)|\.map|\.lock|-lock\.(json|yaml)|\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|jar|wasm|woff2?|ttf|otf|mp[34]|mov|bin|exe|dll|so|dylib|a|o|class|pyc))$/i;

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "struct"
  | "trait"
  | "module"
  | "constant"
  | "method"
  | "macro";

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  path: string;
  line: number;
  signature: string;
}

export interface CodeIndex {
  version: number;
  commit: string;
  files: string[];
  symbols: SymbolEntry[];
}

type Rule = [RegExp, SymbolKind];

// One pattern per declaration form. Group 1 is the symbol name. Lines are
// matched one at a time, so these favor precision over full coverage.
const JS_TS: Rule[] = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, "function"],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
  [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
  [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, "type"],
  [/^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
  [/^\s*(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$.]*)/, "module"],
  [/^\s*export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, "constant"],
  [
    /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    "function",
  ],
  [
    /^\s+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|override\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^={;]+)?\s*\{\s*$/,
    "method",
  ],
];

const PYTHON: Rule[] = [
  [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"],
  [/^\s*class\s+([A-Za-z_]\w*)/, "class"],
  [/^([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/, "constant"],
];

const GO: Rule[] = [
  [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "function"],
  [/^type\s+([A-Za-z_]\w*)\s+struct\b/, "struct"],
  [/^type\s+([A-Za-z_]\w*)\s+interface\b/, "interface"],
  [/^type\s+([A-Za-z_]\w*)\b/, "type"],
];

const RUST: Rule[] = [
  [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/,
    "function",
  ],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, "struct"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, "enum"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)/, "trait"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, "type"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, "module"],
  [/^\s*macro_rules!\s*([A-Za-z_]\w*)/, "macro"],
];

const JVM_CS: Rule[] = [
  [
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|sealed|open|data|partial|readonly)\s+)*(?:class|record|object)\s+([A-Za-z_]\w*)/,
    "class",
  ],
  [
    /^\s*(?:(?:public|private|protected|internal|static|sealed)\s+)*(?:interface|@interface)\s+([A-Za-z_]\w*)/,
    "interface",
  ],
  [
    /^\s*(?:(?:public|private|protected|internal|static)\s+)*enum(?:\s+class)?\s+([A-Za-z_]\w*)/,
    "enum",
  ],
  [
    /^\s*(?:(?:public|private|protected|internal|override|suspend|inline|open)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/,
    "function",
  ],
  [
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|virtual|async|default)\s+)+[\w<>[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
    "method",
  ],
];

const C_CPP: Rule[] = [
  [/^\s*#\s*define\s+([A-Za-z_]\w*)/, "macro"],
  [/^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)\s*\{?\s*$/, "struct"],
  [/^\s*(?:enum\s+(?:class\s+)?)([A-Za-z_]\w*)/, "enum"],
  [/^\s*(?:template\s*<[^>]*>\s*)?class\s+(?:[A-Z_]+\s+)?([A-Za-z_]\w*)\s*(?::|\{|$)/, "class"],
  [/^\s*}\s*([A-Za-z_]\w*)\s*;/, "type"],
  [
    /^(?:static\s+|inline\s+|extern\s+|const\s+|unsigned\s+|signed\s+|struct\s+|[A-Z_]+_API\s+)*[A-Za-z_][\w:<>*& ]*[\s*&]([A-Za-z_][\w:~]*)\s*\([^;]*$/,
    "function",
  ],
];

const RUBY: Rule[] = [
  [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, "function"],
  [/^\s*class\s+([A-Z]\w*(?:::\w+)*)/, "class"],
  [/^\s*module\s+([A-Z]\w*(?:::\w+)*)/, "module"],
];

const PHP: Rule[] = [
  [
    /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?([A-Za-z_]\w*)/,
    "function",
  ],
  [/^\s*(?:(?:final|abstract|readonly)\s+)*class\s+([A-Za-z_]\w*)/, "class"],
  [/^\s*interface\s+([A-Za-z_]\w*)/, "interface"],
  [/^\s*trait\s+([A-Za-z_]\w*)/, "trait"],
  [/^\s*enum\s+([A-Za-z_]\w*)/, "enum"],
];

const SWIFT: Rule[] = [
  [
    /^\s*(?:(?:public|private|internal|open|fileprivate|static|final|override|@\w+)\s+)*func\s+([A-Za-z_]\w*)/,
    "function",
  ],
  [/^\s*(?:(?:public|private|internal|open|fileprivate|final)\s+)*class\s+([A-Za-z_]\w*)/, "class"],
  [/^\s*(?:(?:public|private|internal|fileprivate)\s+)*struct\s+([A-Za-z_]\w*)/, "struct"],
  [/^\s*(?:(?:public|private|internal|fileprivate|indirect)\s+)*enum\s+([A-Za-z_]\w*)/, "enum"],
  [/^\s*(?:(?:public|private|internal|fileprivate)\s+)*protocol\s+([A-Za-z_]\w*)/, "interface"],
];

const DART: Rule[] = [
  [/^\s*(?:abstract\s+|sealed\s+|base\s+|final\s+|interface\s+)*class\s+([A-Za-z_]\w*)/, "class"],
  [/^\s*mixin\s+([A-Za-z_]\w*)/, "trait"],
  [/^\s*enum\s+([A-Za-z_]\w*)/, "enum"],
  [/^\s*extension\s+([A-Za-z_]\w*)\s+on\b/, "class"],
  [/^\s*typedef\s+([A-Za-z_]\w*)/, "type"],
];

const LUA: Rule[] = [[/^\s*(?:local\s+)?function\s+([\w.:]+)/, "function"]];

const RULES_BY_EXT: Record<string, Rule[]> = {
  ".ts": JS_TS,
  ".tsx": JS_TS,
  ".mts": JS_TS,
  ".cts": JS_TS,
  ".js": JS_TS,
  ".jsx": JS_TS,
  ".mjs": JS_TS,
  ".cjs": JS_TS,
  ".py": PYTHON,
  ".pyi": PYTHON,
  ".go": GO,
  ".rs": RUST,
  ".java": JVM_CS,
  ".kt": JVM_CS,
  ".kts": JVM_CS,
  ".scala": JVM_CS,
  ".cs": JVM_CS,
  ".c": C_CPP,
  ".h": C_CPP,
  ".cc": C_CPP,
  ".cpp": C_CPP,
  ".cxx": C_CPP,
  ".hpp": C_CPP,
  ".hh": C_CPP,
  ".m": C_CPP,
  ".mm": C_CPP,
  ".rb": RUBY,
  ".php": PHP,
  ".swift": SWIFT,
  ".dart": DART,
  ".lua": LUA,
};

/** Words that the loose method and function patterns pick up from control flow. */
const NOT_A_SYMBOL = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "else",
  "do",
  "try",
  "new",
  "typeof",
  "sizeof",
  "constructor",
]);

export function extractSymbols(relPath: string, content: string): SymbolEntry[] {
  const rules = RULES_BY_EXT[path.extname(relPath).toLowerCase()];
  if (!rules) return [];
  const symbols: SymbolEntry[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    for (const [pattern, kind] of rules) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1];
      if (!name || NOT_A_SYMBOL.has(name)) break;
      symbols.push({
        name,
        kind,
        path: relPath,
        line: i + 1,
        signature: line.trim().slice(0, 200),
      });
      break;
    }
  }
  return symbols;
}

async function walk(root: string): Promise<{ rel: string; full: string }[]> {
  const found: { rel: string; full: string }[] = [];
  const queue = [""];
  while (queue.length && found.length < MAX_FILES) {
    const relDir = queue.shift()!;
    const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(rel);
      } else if (entry.isFile() && !SKIP_FILE.test(entry.name)) {
        found.push({ rel, full: path.join(root, rel) });
      }
    }
  }
  return found;
}

/** Builds the file list and symbol table for a checkout. */
export async function buildIndex(checkout: Checkout): Promise<CodeIndex> {
  const files: string[] = [];
  const symbols: SymbolEntry[] = [];
  for (const file of await walk(checkout.root)) {
    let content: string;
    try {
      const buffer = await readFile(file.full);
      if (buffer.length > MAX_FILE_BYTES || buffer.includes(0)) continue;
      content = buffer.toString("utf8");
    } catch {
      continue;
    }
    files.push(file.rel);
    symbols.push(...extractSymbols(file.rel, content));
  }
  return { version: INDEX_VERSION, commit: checkout.commit, files, symbols };
}

const indexCache = new Map<string, CodeIndex>();

/** Loads the index from memory or disk, or builds and stores it. */
export async function loadIndex(checkout: Checkout): Promise<CodeIndex> {
  const memo = indexCache.get(checkout.dir);
  if (memo && memo.commit === checkout.commit) return memo;

  const indexPath = path.join(checkout.dir, "index.json");
  try {
    const stored = JSON.parse(await readFile(indexPath, "utf8")) as CodeIndex;
    if (stored.version === INDEX_VERSION && stored.commit === checkout.commit) {
      indexCache.set(checkout.dir, stored);
      return stored;
    }
  } catch {
    // No usable index on disk yet.
  }

  const index = await buildIndex(checkout);
  await writeFile(indexPath, JSON.stringify(index));
  indexCache.set(checkout.dir, index);
  return index;
}
