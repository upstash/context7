import type { EvalResult } from "./types.js";

export interface ScenarioSummary {
  scenario: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  triggerRate: number;
  quietRate: number;
  avgToolCalls: number;
  avgDurationMs: number;
  errors: number;
}

/**
 * Groups results by scenario (unique sorted combination of integration names)
 * and computes pass rate and timing per scenario.
 */
export function summarize(results: EvalResult[]): ScenarioSummary[] {
  const groups = new Map<string, EvalResult[]>();

  for (const r of results) {
    const key =
      r.case.integrations
        .map((i) => i.name)
        .sort()
        .join(" + ") || "none";
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }

  return Array.from(groups.entries()).map(([scenario, runs]) => {
    const passed = runs.filter((r) => r.pass).length;
    const errors = runs.filter((r) => r.error).length;
    const avgDurationMs = Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length);

    const triggerRuns = runs.filter((r) => r.case.expect.invokes?.length);
    const quietRuns = runs.filter((r) => r.case.expect.skips?.length);
    const triggerRate =
      triggerRuns.length > 0 ? triggerRuns.filter((r) => r.pass).length / triggerRuns.length : 1;
    const quietRate =
      quietRuns.length > 0 ? quietRuns.filter((r) => r.pass).length / quietRuns.length : 1;

    const invocatingRuns = runs.filter((r) => r.actualInvocations.length > 0);
    const avgToolCalls =
      invocatingRuns.length > 0
        ? Math.round(
            (invocatingRuns.reduce((s, r) => s + r.actualInvocations.length, 0) /
              invocatingRuns.length) *
              10
          ) / 10
        : 0;

    return {
      scenario,
      total: runs.length,
      passed,
      failed: runs.length - passed,
      passRate: passed / runs.length,
      triggerRate,
      quietRate,
      avgToolCalls,
      avgDurationMs,
      errors,
    };
  });
}

export function printReport(results: EvalResult[]): void {
  const triggerResults = results.filter((r) => r.case.expect.invokes?.length);
  const quietResults = results.filter((r) => r.case.expect.skips?.length);
  const scenario = results[0]?.case.integrations.map((i) => i.name).join(" + ") ?? "unknown";

  const divider = "-".repeat(52);
  console.log(`\n${divider}`);
  console.log(`Integration: ${scenario}`);
  console.log(
    `Prompts:     ${results.length} total  (${triggerResults.length} should trigger, ${quietResults.length} should stay quiet)`
  );
  console.log(divider);

  const triggerPassed = triggerResults.filter((r) => r.pass).length;
  const quietPassed = quietResults.filter((r) => r.pass).length;
  const invocatingRuns = results.filter((r) => r.actualInvocations.length > 0);
  const avgCalls =
    invocatingRuns.length > 0
      ? Math.round(
          (invocatingRuns.reduce((s, r) => s + r.actualInvocations.length, 0) /
            invocatingRuns.length) *
            10
        ) / 10
      : 0;
  const avgMs = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);

  console.log(
    `Triggered on relevant queries   ${triggerPassed}/${triggerResults.length}   ${pct(triggerPassed, triggerResults.length)}`
  );
  console.log(
    `Stayed quiet on off-topic       ${quietPassed}/${quietResults.length}   ${pct(quietPassed, quietResults.length)}`
  );
  console.log(`Avg tool calls per invocation   ${avgCalls}`);
  console.log(`Avg response time               ${avgMs}ms`);
  console.log(divider + "\n");

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`Failures (${failures.length}):`);
    for (const f of failures) {
      const label = f.case.name ?? f.case.prompt.slice(0, 60);
      const used = formatInvocations(f.actualInvocations.map((i) => i.integration)) || "nothing";
      const expected = [
        ...(f.case.expect.invokes?.map((n) => `+${n}`) ?? []),
        ...(f.case.expect.skips?.map((n) => `-${n}`) ?? []),
      ].join(", ");
      console.log(`  FAIL  "${label}"`);
      console.log(`         expected: ${expected || "(no tools)"}`);
      console.log(`         got:      ${used}`);
      if (f.error) console.log(`         error:    ${f.error}`);
    }
    console.log("");
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((n / total) * 100)}%`;
}

export interface AgentRun {
  agent: string;
  results: EvalResult[];
}

export interface ScenarioGroup {
  label: string;
  runs: AgentRun[];
}

/**
 * Prints a per-prompt comparison table with scenario groups and agent sub-columns.
 *
 * @example
 * ```ts
 * printComparison([
 *   { label: "skill-only", runs: [
 *       { agent: "claude", results: claudeResults },
 *       { agent: "ocode",  results: ocodeResults },
 *       { agent: "aisdk",  results: aisdkResults },
 *   ]},
 *   { label: "mcp-only", runs: [...] },
 *   { label: "both",     runs: [...] },
 * ]);
 * ```
 */
export function printComparison(scenarios: ScenarioGroup[]): void {
  if (scenarios.length === 0) return;

  const prompts = scenarios[0].runs[0]?.results.map((r) => r.case.prompt) ?? [];

  const allIntegrationNames = new Set(
    scenarios.flatMap((s) =>
      s.runs.flatMap((a) => a.results.flatMap((r) => r.actualInvocations.map((i) => i.integration)))
    )
  );
  const integrationShortCodes = new Map<string, string>(
    scenarios.flatMap((s) =>
      s.runs.flatMap((a) =>
        a.results.flatMap((r) =>
          r.case.integrations
            .filter((i) => i.shortCode)
            .map((i) => [i.name, i.shortCode!] as [string, string])
        )
      )
    )
  );
  const shortCode = buildShortCodes(allIntegrationNames, integrationShortCodes);

  const TYPE_W = 7;
  const PROMPT_W = Math.max(8, ...prompts.map((p) => truncate(p, 40).length));
  const AGENT_W = Math.max(8, ...scenarios.flatMap((s) => s.runs.map((a) => a.agent.length)));
  const GAP = "  ";
  const SEP = " | ";

  const groupWidth = (n: number) => n * AGENT_W + (n - 1) * GAP.length;

  // --- Group header row ---
  const groupHeaderCells = scenarios.map((s) => center(s.label, groupWidth(s.runs.length)));
  const groupHeader = [pad("", TYPE_W), pad("", PROMPT_W), ...groupHeaderCells].join(SEP);

  // --- Agent name row ---
  const agentCellsByGroup = scenarios.map((s) =>
    s.runs.map((a) => pad(a.agent, AGENT_W)).join(GAP)
  );
  const agentHeader = [pad("invoke?", TYPE_W), pad("Prompt", PROMPT_W), ...agentCellsByGroup].join(
    SEP
  );

  const divider = "-".repeat(agentHeader.length);

  console.log("\nCOMPARISON");
  console.log(divider);
  console.log(groupHeader);
  console.log(agentHeader);
  console.log(divider);

  for (let i = 0; i < prompts.length; i++) {
    const r0 = scenarios[0].runs[0]?.results[i];
    const type = r0?.case.expect.invokes?.length ? "yes" : "no";

    const cellsByGroup = scenarios.map((s) => {
      const sr0 = s.runs[0]?.results[i];
      const singleIntegration = (sr0?.case.integrations.length ?? 1) <= 1;
      return s.runs
        .map((a) => {
          const result = a.results[i];
          if (!result) return pad("–", AGENT_W);
          return renderCell(result, singleIntegration, shortCode, AGENT_W);
        })
        .join(GAP);
    });

    console.log(
      [pad(type, TYPE_W), pad(truncate(prompts[i], 40), PROMPT_W), ...cellsByGroup].join(SEP)
    );
  }

  console.log(divider);

  // --- Summary footer ---
  const footerRow = (label: string, filterFn: (r: EvalResult) => boolean) => {
    const groupSummaries = scenarios.map((s) =>
      s.runs
        .map((a) => {
          const filtered = a.results.filter(filterFn);
          if (filtered.length === 0) return pad("–", AGENT_W);
          return pad(pct(filtered.filter((r) => r.pass).length, filtered.length), AGENT_W);
        })
        .join(GAP)
    );
    return [pad("", TYPE_W), pad(label, PROMPT_W), ...groupSummaries].join(SEP);
  };

  console.log(footerRow("Triggered on relevant", (r) => !!r.case.expect.invokes?.length));
  console.log(footerRow("Stayed quiet on off-topic", (r) => !!r.case.expect.skips?.length));
  console.log(divider + "\n");
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const CHECK = `${GREEN}✓${RESET}`;
const CROSS = `${RED}✗${RESET}`;

function renderCell(
  result: EvalResult,
  singleIntegration: boolean,
  shortCodes: Map<string, string>,
  colW: number
): string {
  const names = result.actualInvocations.map((i) => i.integration);
  const pass = result.pass;
  const hasExpect = result.case.expect.invokes || result.case.expect.skips;

  if (names.length === 0) {
    return pad(pass || !hasExpect ? "–" : CROSS, colW);
  }

  if (singleIntegration) {
    return pad(!hasExpect ? "·" : pass ? CHECK : CROSS, colW);
  }

  // Multi-integration: show which integration(s) won
  const unique = [...new Set(names)];
  const label = unique.map((n) => shortCodes.get(n) ?? n).join("+");
  const indicator = !hasExpect ? "" : pass ? ` ${CHECK}` : ` ${CROSS}`;
  return pad(label + indicator, colW);
}

function center(s: string, width: number): string {
  const vlen = visibleLength(s);
  if (vlen >= width) return s;
  const total = width - vlen;
  const left = Math.floor(total / 2);
  return " ".repeat(left) + s + " ".repeat(total - left);
}

function formatInvocations(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name}(×${count})` : name))
    .join("+");
}

function buildShortCodes(names: Set<string>, overrides?: Map<string, string>): Map<string, string> {
  const codes = new Map<string, string>();
  for (const name of names) {
    if (overrides?.has(name)) {
      codes.set(name, overrides.get(name)!);
      continue;
    }
    // Use the last segment after the final "-" or "/" as the short code
    const parts = name.split(/[-/]/);
    const candidate = parts[parts.length - 1] ?? name;
    // Ensure uniqueness by falling back to full name if there's a collision
    const isUnique = !Array.from(codes.values()).includes(candidate);
    codes.set(name, isUnique ? candidate : name);
  }
  return codes;
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function pad(s: string, width: number): string {
  const vlen = visibleLength(s);
  return vlen >= width ? s : s + " ".repeat(width - vlen);
}
