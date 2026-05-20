import { mkdirSync, writeFileSync } from "node:fs";
import { MODE_CONFIGS } from "./modes.js";
import { RESULTS_DIR, EVAL_SET_PATH } from "./environment.js";
import type { ModeSummary } from "./types.js";
import { basename } from "node:path";

export function writeReport(allResults: Record<string, ModeSummary>, model: string): void {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 15);
  const reportPath = `${RESULTS_DIR}/report-${model}-${ts}.md`;
  const jsonPath = `${RESULTS_DIR}/results-${model}-${ts}.json`;

  writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const lines: string[] = [
    "# Context7 Trigger Eval Report",
    "",
    `- **Model:** ${model}`,
    `- **Date:** ${dateStr}`,
    `- **Eval set:** ${basename(EVAL_SET_PATH)}`,
    "",
    "## Summary",
    "",
    "| Mode | Recall | Precision | False Pos | Time |",
    "|------|--------|-----------|-----------|------|",
  ];

  for (const [modeName, summary] of Object.entries(allResults)) {
    lines.push(
      `| ${modeName} | ${summary.recall} | ${summary.precision} | ${summary.falsePositives} | ${summary.elapsedSeconds}s |`
    );
  }

  for (const [modeName, summary] of Object.entries(allResults)) {
    const desc = MODE_CONFIGS[modeName]?.description ?? "";
    lines.push(`\n## ${modeName}`);
    lines.push(`_${desc}_\n`);

    lines.push("### Should Trigger\n");
    lines.push("| # | Triggered | First Tool | Query |");
    lines.push("|---|-----------|------------|-------|");
    for (let i = 0; i < summary.results.length; i++) {
      const r = summary.results[i];
      if (r.shouldTrigger) {
        const mark = r.triggered ? "yes" : "no";
        const tool = r.firstTool ?? "-";
        lines.push(`| ${i + 1} | ${mark} | ${tool} | ${r.query.slice(0, 70)} |`);
      }
    }

    lines.push("\n### Should NOT Trigger\n");
    lines.push("| # | Triggered | First Tool | Query |");
    lines.push("|---|-----------|------------|-------|");
    for (let i = 0; i < summary.results.length; i++) {
      const r = summary.results[i];
      if (!r.shouldTrigger) {
        const mark = r.triggered ? "yes" : "no";
        const tool = r.firstTool ?? "-";
        lines.push(`| ${i + 1} | ${mark} | ${tool} | ${r.query.slice(0, 70)} |`);
      }
    }
  }

  writeFileSync(reportPath, lines.join("\n") + "\n");
  console.log(`\nReport: ${reportPath}`);
  console.log(`JSON:   ${jsonPath}`);
}
