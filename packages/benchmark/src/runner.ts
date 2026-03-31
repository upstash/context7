import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { MODE_CONFIGS, PROJECT_ROOT, CONTEXT_PREFIXES } from "./modes.js";
import { setupMode, teardown, EVAL_SET_PATH } from "./environment.js";
import { detectTrigger, extractToolChain } from "./detection.js";
import type { EvalItem, EvalResult, QueryResult, ModeSummary } from "./types.js";

function runQuery(
  query: string,
  mode: string,
  model: string,
  maxTurns: number,
  timeout: number,
  contextPrefix: string | null,
  authMode: string
): Promise<QueryResult> {
  const fullQuery = contextPrefix ? `${contextPrefix}${query}` : query;

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "CLAUDECODE" && v !== undefined) {
      env[k] = v;
    }
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";

  if (authMode === "api-key" && !env.ANTHROPIC_API_KEY) {
    return Promise.resolve({
      triggered: false,
      firstTool: null,
      elapsed: 0,
      error: "ANTHROPIC_API_KEY is not set",
    });
  }

  const args = [
    "-p",
    fullQuery,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(maxTurns),
    "--model",
    model,
  ];

  const t0 = Date.now();

  return new Promise<QueryResult>((resolve) => {
    execFile(
      "claude",
      args,
      {
        encoding: "utf-8",
        timeout: timeout * 1000,
        env,
        cwd: PROJECT_ROOT,
        maxBuffer: 50 * 1024 * 1024,
      },
      (error, stdout) => {
        const elapsed = (Date.now() - t0) / 1000;
        const roundedElapsed = Math.round(elapsed * 10) / 10;

        if (error && !stdout) {
          if (error.killed) {
            resolve({ triggered: false, firstTool: null, elapsed: timeout, error: "timeout" });
          } else {
            resolve({ triggered: false, firstTool: null, elapsed: 0, error: String(error) });
          }
          return;
        }

        const output = stdout ?? "";
        const detection = MODE_CONFIGS[mode].detection;
        const triggered = detectTrigger(detection, output);
        const firstTool = extractToolChain(output);
        resolve({ triggered, firstTool, elapsed: roundedElapsed, error: null });
      }
    );
  });
}

export async function runMode(
  mode: string,
  evalSet: EvalItem[],
  model: string,
  maxTurns: number,
  workers: number,
  timeout: number,
  withContext: boolean,
  authMode: string
): Promise<ModeSummary> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`MODE: ${mode}`);
  console.log(`${"=".repeat(60)}`);

  await setupMode(mode);
  await new Promise((r) => setTimeout(r, 1000));

  const total = evalSet.length;
  const results: EvalResult[] = new Array(total);

  console.log(
    `  Running ${total} queries (workers=${workers}, model=${model}, max_turns=${maxTurns})...`
  );
  const t0 = Date.now();

  let completed = 0;
  const pending = new Set<Promise<void>>();

  async function processItem(i: number): Promise<void> {
    const item = evalSet[i];
    const prefix = withContext ? CONTEXT_PREFIXES[i % CONTEXT_PREFIXES.length] : null;
    const res = await runQuery(item.query, mode, model, maxTurns, timeout, prefix, authMode);

    const passed = res.triggered === item.should_trigger;
    results[i] = {
      query: item.query,
      shouldTrigger: item.should_trigger,
      triggered: res.triggered,
      pass: passed,
      firstTool: res.firstTool,
      elapsed: res.elapsed,
      error: res.error,
    };

    completed++;
    const indicator = passed ? "+" : "X";
    const status = passed ? "PASS" : "FAIL";
    const toolInfo = res.firstTool ? ` [${res.firstTool}]` : " [no tool]";
    console.log(
      `  [${indicator}] ${completed}/${total} ${status}${toolInfo}: ${item.query.slice(0, 60)}`
    );
  }

  const queue = evalSet.map((_, i) => i);

  async function runPool(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const i of queue) {
      const p = processItem(i);
      promises.push(p);
      pending.add(p);
      p.finally(() => pending.delete(p));

      if (pending.size >= workers) {
        await Promise.race(pending);
      }
    }

    await Promise.all(promises);
  }

  await runPool();

  const elapsed = (Date.now() - t0) / 1000;

  const shouldTrigger = results.filter((r) => r.shouldTrigger);
  const shouldNot = results.filter((r) => !r.shouldTrigger);
  const truePos = shouldTrigger.filter((r) => r.triggered).length;
  const falsePos = shouldNot.filter((r) => r.triggered).length;
  const recall = truePos / Math.max(1, shouldTrigger.length);
  const precision = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : 0;

  const recallStr = `${truePos}/${shouldTrigger.length} (${Math.round(recall * 100)}%)`;
  const precisionStr =
    truePos + falsePos > 0
      ? `${truePos}/${truePos + falsePos} (${Math.round(precision * 100)}%)`
      : "N/A";

  const summary: ModeSummary = {
    mode,
    model,
    maxTurns,
    elapsedSeconds: Math.round(elapsed * 10) / 10,
    authMode,
    total,
    passed: results.filter((r) => r.pass).length,
    recall: recallStr,
    precision: precisionStr,
    falsePositives: falsePos,
    results,
  };

  console.log(`\n  --- ${mode} Summary ---`);
  console.log(`  Recall:    ${recallStr}`);
  console.log(`  Precision: ${precisionStr}`);
  console.log(`  FP:        ${falsePos}/${shouldNot.length}`);
  console.log(`  Time:      ${Math.round(elapsed)}s`);

  console.log(`\n  Should trigger:`);
  for (const r of results) {
    if (r.shouldTrigger) {
      const mark = r.triggered ? "+" : "-";
      const tool = r.firstTool ? ` [${r.firstTool}]` : "";
      console.log(`    [${mark}]${tool} ${r.query.slice(0, 75)}`);
    }
  }

  console.log(`\n  Should NOT trigger:`);
  for (const r of results) {
    if (!r.shouldTrigger) {
      const mark = r.triggered ? "!" : ".";
      const tool = r.firstTool ? ` [${r.firstTool}]` : "";
      console.log(`    [${mark}]${tool} ${r.query.slice(0, 75)}`);
    }
  }

  return summary;
}

export function loadEvalSet(): EvalItem[] {
  return JSON.parse(readFileSync(EVAL_SET_PATH, "utf-8"));
}

export { teardown };
