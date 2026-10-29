import { CodeSearchError, ensureCheckout, type CodeSearchConfig } from "./checkout.js";
import { loadIndex } from "./indexer.js";
import {
  findSymbols,
  formatMatches,
  formatSymbols,
  grepCode,
  readLibraryFile,
  type SearchMode,
} from "./search.js";
import type { ToolCallOutcome } from "../tool-names.js";

export interface CodeToolResult {
  text: string;
  outcome: ToolCallOutcome;
}

export interface SearchLibraryCodeArgs {
  libraryId: string;
  pattern: string;
  mode?: SearchMode;
  version?: string;
  path?: string;
  maxResults?: number;
}

export interface ReadLibraryFileArgs {
  libraryId: string;
  path: string;
  version?: string;
  startLine?: number;
  endLine?: number;
}

const DEFAULT_RESULTS = 20;
const MAX_RESULTS = 50;

function failure(error: unknown): CodeToolResult {
  if (error instanceof CodeSearchError) return { text: error.message, outcome: "error" };
  return { text: "Source search failed. Please try again later.", outcome: "error" };
}

export async function searchLibraryCode(
  config: CodeSearchConfig,
  args: SearchLibraryCodeArgs
): Promise<CodeToolResult> {
  try {
    const pattern = args.pattern.trim();
    if (!pattern) throw new CodeSearchError("Pattern must not be empty.");
    const maxResults = Math.min(MAX_RESULTS, Math.max(1, args.maxResults ?? DEFAULT_RESULTS));
    const mode = args.mode ?? "literal";
    const checkout = await ensureCheckout(config, args.libraryId, args.version);

    if (mode === "symbol") {
      const index = await loadIndex(checkout);
      const symbols = findSymbols(index, pattern, maxResults);
      return {
        text: formatSymbols(checkout, pattern, symbols),
        outcome: symbols.length ? "success" : "not_found",
      };
    }

    const matches = await grepCode(checkout, { pattern, mode, path: args.path, maxResults });
    return {
      text: formatMatches(checkout, pattern, matches),
      outcome: matches.length ? "success" : "not_found",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function readLibrarySourceFile(
  config: CodeSearchConfig,
  args: ReadLibraryFileArgs
): Promise<CodeToolResult> {
  try {
    const checkout = await ensureCheckout(config, args.libraryId, args.version);
    const index = await loadIndex(checkout);
    const text = await readLibraryFile(checkout, index, args.path, args.startLine, args.endLine);
    return { text, outcome: "success" };
  } catch (error) {
    return failure(error);
  }
}
