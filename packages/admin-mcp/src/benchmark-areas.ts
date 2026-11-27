/**
 * The benchmark grader's five criteria: the key of each in a graded answer's `subscores`
 * (management API, `GET .../libraries/{owner}/{repo}/benchmarks`) and the points it is out of.
 * The grader is in context7parser (`lib/prompts/scoreQuestionPrompt.ts`); change both together.
 * No imports: the console page (ui/) and its demo bundle this file too.
 */
export const BENCHMARK_AREAS = [
  { key: "implementation", label: "Implementation guidance", max: 40 },
  { key: "api", label: "API accuracy", max: 25 },
  { key: "relevance", label: "Relevance to the question", max: 20 },
  { key: "completeness", label: "Completeness", max: 10 },
  { key: "clarity", label: "Clarity", max: 5 },
] as const;

export type BenchmarkAreaKey = (typeof BENCHMARK_AREAS)[number]["key"];

/** The grader's points for one answer, each out of its criterion's maximum (null when not graded). */
export type Subscores = Record<BenchmarkAreaKey, number | null>;

/**
 * Each criterion's average share of its points (0 to 100) across the graded answers, weakest
 * first. A value that is not a number from 0 to the criterion's maximum is left out, so answers
 * graded on another scale give no figure instead of a wrong one; a criterion with no usable value
 * is not listed.
 */
export function weakestAreas(
  benchmarks: readonly { subscores?: Partial<Record<string, unknown>> | null }[]
): { key: BenchmarkAreaKey; label: string; score: number }[] {
  return BENCHMARK_AREAS.flatMap(({ key, label, max }) => {
    const points = benchmarks.flatMap((benchmark) => {
      const value = benchmark.subscores?.[key];
      return typeof value === "number" && value >= 0 && value <= max ? [value] : [];
    });
    if (points.length === 0) return [];
    const average = points.reduce((sum, value) => sum + value, 0) / points.length;
    return [{ key, label, score: (average / max) * 100 }];
  }).sort((a, b) => a.score - b.score);
}

/** Graded answers newest first, by `benchmarkDate`; one without a readable date goes last. */
export function newestFirst<T extends { benchmarkDate?: string }>(benchmarks: readonly T[]): T[] {
  const time = (benchmark: T) => {
    const parsed = Date.parse(benchmark.benchmarkDate ?? "");
    return Number.isNaN(parsed) ? -Infinity : parsed;
  };
  return [...benchmarks].sort((a, b) => time(b) - time(a));
}
