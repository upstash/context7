import { Command } from "commander";
import { MODE_CONFIGS } from "./modes.js";
import { runMode, loadEvalSet, teardown } from "./runner.js";
import { writeReport } from "./reporter.js";
import type { BenchOptions, ModeSummary } from "./types.js";

const DEFAULT_MODES = ["mcp:prod", "mcp:dev", "cli:prod", "cli:dev"].join(",");

const program = new Command()
  .name("benchmark")
  .description("Context7 trigger eval -- benchmarks trigger accuracy across integration modes")
  .option("--modes <modes>", "Comma-separated modes to test", DEFAULT_MODES)
  .option("--model <model>", "Claude model to use", "claude-opus-4-6")
  .option("--workers <n>", "Number of concurrent workers", "60")
  .option("--max-turns <n>", "Max turns per query", "10")
  .option("--timeout <seconds>", "Timeout per query in seconds", "120")
  .option("--auth-mode <mode>", "Auth mode: default or api-key", "default")
  .option("--with-context", "Prepend realistic conversation context to queries", false)
  .option("--compare", "Run each mode twice (clean + with-context) and compare", false);
// Strip leading `--` that pnpm injects when forwarding args
const argv = process.argv.filter((a, i) => !(a === "--" && i === 2));
program.parse(argv);

const opts = program.opts();

const options: BenchOptions = {
  modes: opts.modes.split(",").map((m: string) => m.trim()),
  model: opts.model,
  workers: parseInt(opts.workers, 10),
  maxTurns: parseInt(opts.maxTurns, 10),
  timeout: parseInt(opts.timeout, 10),
  authMode: opts.authMode as "default" | "api-key",
  withContext: opts.withContext,
  compare: opts.compare,
};

async function main(): Promise<void> {
  const evalSet = loadEvalSet();

  console.log("Context7 Trigger Eval");
  console.log(`Modes:     ${options.modes.join(", ")}`);
  console.log(`Model:     ${options.model}`);
  console.log(`Queries:   ${evalSet.length}`);
  console.log(`Workers:   ${options.workers}`);
  console.log(`Max turns: ${options.maxTurns}`);
  console.log(`Auth:      ${options.authMode}`);
  if (options.compare) {
    console.log("Compare:   ON (clean vs mid-session for each mode)");
  } else {
    console.log(
      `Context:   ${options.withContext ? "ON (mid-session simulation)" : "OFF (clean queries)"}`
    );
  }

  console.log("\nAvailable modes:");
  for (const [name, cfg] of Object.entries(MODE_CONFIGS)) {
    const marker = options.modes.includes(name) ? "*" : " ";
    console.log(`  [${marker}] ${name.padEnd(18)} ${cfg.description}`);
  }

  const allResults: Record<string, ModeSummary> = {};

  try {
    if (options.compare) {
      for (const mode of options.modes) {
        const cleanKey = mode;
        const ctxKey = `${mode} (ctx)`;
        allResults[cleanKey] = await runMode(
          mode,
          evalSet,
          options.model,
          options.maxTurns,
          options.workers,
          options.timeout,
          false,
          options.authMode
        );
        allResults[ctxKey] = await runMode(
          mode,
          evalSet,
          options.model,
          options.maxTurns,
          options.workers,
          options.timeout,
          true,
          options.authMode
        );
      }
    } else {
      for (const mode of options.modes) {
        allResults[mode] = await runMode(
          mode,
          evalSet,
          options.model,
          options.maxTurns,
          options.workers,
          options.timeout,
          options.withContext,
          options.authMode
        );
      }
    }
  } finally {
    teardown();
  }

  writeReport(allResults, options.model);

  // Final comparison
  console.log(`\n${"=".repeat(85)}`);
  console.log("FINAL COMPARISON");
  console.log(`${"=".repeat(85)}`);

  if (options.compare) {
    console.log(
      `${"Mode".padEnd(22)} ${"Recall (clean)".padEnd(18)} ${"Recall (ctx)".padEnd(18)} ${"Delta".padEnd(10)} ${"FP".padEnd(5)}`
    );
    console.log("-".repeat(85));
    for (const mode of options.modes) {
      const clean = allResults[mode] ?? ({} as ModeSummary);
      const ctx = allResults[`${mode} (ctx)`] ?? ({} as ModeSummary);
      const cRecall = clean.recall ?? "N/A";
      const xRecall = ctx.recall ?? "N/A";

      const cResults = clean.results ?? [];
      const xResults = ctx.results ?? [];
      const cTp = cResults.filter((r) => r.shouldTrigger && r.triggered).length;
      const xTp = xResults.filter((r) => r.shouldTrigger && r.triggered).length;
      const cTotal = cResults.filter((r) => r.shouldTrigger).length;
      const xTotal = xResults.filter((r) => r.shouldTrigger).length;

      let deltaStr: string;
      if (cTotal > 0 && xTotal > 0) {
        const deltaPct = Math.round((xTp / xTotal - cTp / cTotal) * 100);
        deltaStr = `${deltaPct > 0 ? "+" : ""}${deltaPct}%`;
      } else {
        deltaStr = "N/A";
      }
      const fp = clean.falsePositives ?? 0;
      console.log(
        `${mode.padEnd(22)} ${cRecall.padEnd(18)} ${xRecall.padEnd(18)} ${deltaStr.padEnd(10)} ${String(fp).padEnd(5)}`
      );
    }
  } else {
    console.log(
      `${"Mode".padEnd(20)} ${"Recall".padEnd(20)} ${"Precision".padEnd(20)} ${"FP".padEnd(5)}`
    );
    console.log("-".repeat(70));
    for (const [modeName, s] of Object.entries(allResults)) {
      console.log(
        `${modeName.padEnd(20)} ${s.recall.padEnd(20)} ${s.precision.padEnd(20)} ${String(s.falsePositives).padEnd(5)}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
