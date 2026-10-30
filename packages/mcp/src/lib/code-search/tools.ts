import {
  CodeSearchError,
  ensureCheckout,
  type Checkout,
  type CodeSearchConfig,
} from "./checkout.js";
import { loadIndex } from "./indexer.js";
import { estimateTokens } from "./safety.js";
import {
  countMatches,
  findSymbols,
  formatCounts,
  formatMatches,
  formatSymbols,
  grepCode,
  readLibraryFile,
  type OutputMode,
  type SearchMode,
} from "./search.js";
import type { ToolCallOutcome } from "../tool-names.js";

export interface CodeToolResult {
  text: string;
  outcome: ToolCallOutcome;
  /** The call did not fail: the repository is still downloading. Retry later. */
  retryable?: boolean;
}

export interface SearchLibraryCodeArgs {
  libraryId: string;
  pattern: string;
  mode?: SearchMode;
  version?: string;
  path?: string;
  maxResults?: number;
  output?: OutputMode;
  offset?: number;
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

class CheckoutPending extends Error {}

function failure(error: unknown): CodeToolResult {
  if (error instanceof CheckoutPending) {
    return { text: error.message, outcome: "error", retryable: true };
  }
  if (error instanceof CodeSearchError) return { text: error.message, outcome: "error" };
  return { text: "Source search failed. Please try again later.", outcome: "error" };
}

function done(text: string, outcome: ToolCallOutcome): CodeToolResult {
  return { text: `${text}\n\n[~${estimateTokens(text)} tokens]`, outcome };
}

/**
 * Waits for the checkout up to `cloneWaitMs`. A large clone can take longer than
 * an MCP client waits for a tool call, so the clone keeps running in the
 * background and the agent is asked to call again.
 */
async function checkoutWithin(
  config: CodeSearchConfig,
  libraryId: string,
  version?: string
): Promise<Checkout> {
  const pending = ensureCheckout(config, libraryId, version);
  const waitMs = config.cloneWaitMs ?? 0;
  if (waitMs <= 0) return pending;

  // The clone may finish after this call returns. Its result is reused next time.
  pending.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"pending">((resolve) => {
    timer = setTimeout(() => resolve("pending"), waitMs);
  });
  try {
    const result = await Promise.race([pending, timeout]);
    if (result === "pending") {
      throw new CheckoutPending(
        `The source of ${libraryId} is still downloading. This is not an error. Call the tool again with the same arguments in about 30 seconds.`
      );
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
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
    const output = args.output ?? "content";
    const checkout = await checkoutWithin(config, args.libraryId, args.version);

    if (mode === "symbol") {
      const index = await loadIndex(checkout);
      const symbols = findSymbols(index, pattern, maxResults);
      return done(
        formatSymbols(checkout, pattern, symbols),
        symbols.length ? "success" : "not_found"
      );
    }

    const options = { pattern, mode, path: args.path, maxResults, offset: args.offset };
    if (output !== "content") {
      const counts = await countMatches(checkout, options);
      return done(
        formatCounts(checkout, pattern, counts, output, maxResults, args.offset),
        counts.length ? "success" : "not_found"
      );
    }

    const page = await grepCode(checkout, options);
    return done(
      formatMatches(checkout, pattern, page),
      page.matches.length ? "success" : "not_found"
    );
  } catch (error) {
    return failure(error);
  }
}

export async function readLibrarySourceFile(
  config: CodeSearchConfig,
  args: ReadLibraryFileArgs
): Promise<CodeToolResult> {
  try {
    const checkout = await checkoutWithin(config, args.libraryId, args.version);
    const index = await loadIndex(checkout);
    const text = await readLibraryFile(checkout, index, args.path, args.startLine, args.endLine);
    return done(text, "success");
  } catch (error) {
    return failure(error);
  }
}
