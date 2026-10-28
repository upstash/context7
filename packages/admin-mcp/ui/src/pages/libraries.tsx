import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { ScoreHistogram } from "../charts";
import {
  Button,
  Card,
  ChatButton,
  Empty,
  Loaded,
  Metric,
  Metrics,
  MetricsSkeleton,
  RowsSkeleton,
  Segmented,
  StateLabel,
  scoreTone,
  useWide,
} from "../components";
import { useTool, type Benchmarks, type Library } from "../data";
import { ago, num } from "../format";
import { host } from "../host";

const libraryName = (library: Library) => library.title ?? library.id;

/** Lowest benchmark score first; libraries without a score after them. */
const byScore = (a: Library, b: Library) => (a.benchmarkScore ?? 101) - (b.benchmarkScore ?? 101);

export function LibrariesSummary({ teamspace }: { teamspace: string }) {
  const result = useTool<{ libraries: Library[] }>("list_libraries", { teamspace });
  return (
    <Loaded result={result} skeleton={<RowsSkeleton rows={4} />}>
      {({ libraries }) => {
        if (libraries.length === 0) return <Empty>No private or claimed libraries yet.</Empty>;
        const scored = libraries.filter((l) => l.benchmarkScore !== undefined).sort(byScore);
        const busy = libraries.filter(
          (l) => l.state === "processing" || l.state === "finalizing"
        ).length;
        const failed = libraries.filter((l) => l.state === "error").length;
        return (
          <div className="grid gap-4">
            <p className="text-sm text-fg-2">
              {libraries.length} libraries
              {busy > 0 && ` · ${busy} parsing`}
              {failed > 0 && <span className="text-bad"> · {failed} failed</span>}
            </p>
            {scored.length > 0 && (
              <ol className="grid">
                {scored.slice(0, 4).map((library) => (
                  <li
                    key={library.id}
                    className="flex items-center gap-3 border-t border-divider py-3 first:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{libraryName(library)}</span>
                    <ScoreBar score={library.benchmarkScore!} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <span className="flex w-28 shrink-0 items-center gap-2">
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-fg/8" aria-hidden>
        <span
          className={`block h-full rounded-full ${score >= 80 ? "bg-score-good" : score >= 50 ? "bg-score-warn" : "bg-score-bad"}`}
          style={{ width: `${score}%` }}
        />
      </span>
      <span className={`w-7 text-right text-sm font-semibold tabular-nums ${scoreTone(score)}`}>
        {Math.round(score)}
      </span>
    </span>
  );
}

export function LibrariesPage({ teamspace, name }: { teamspace: string; name: string }) {
  const result = useTool<{ libraries: Library[] }>("list_libraries", { teamspace });
  const [selected, setSelected] = useState<string>();
  const [sort, setSort] = useState<"score" | "name">("score");
  // Wide: list and detail side by side. Narrow: the detail replaces the list, with Back.
  const wide = useWide(896);
  useEffect(() => {
    if (!selected)
      host.setModelContext(
        `The user is looking at the libraries of teamspace "${name}" (${teamspace}) in the Context7 console.`
      );
  }, [teamspace, name, selected]);

  return (
    <Loaded
      result={result}
      skeleton={
        <Card>
          <RowsSkeleton rows={6} />
        </Card>
      }
    >
      {({ libraries }) => {
        if (libraries.length === 0)
          return (
            <Card>
              <Empty>
                No private or claimed libraries yet. Add one with add_library or claim one with
                claim_library.
              </Empty>
            </Card>
          );
        const current = libraries.find((l) => l.id === selected);
        const sorted = [...libraries].sort(
          sort === "score" ? byScore : (a, b) => libraryName(a).localeCompare(libraryName(b))
        );
        const list = (
          <Card
            title={`${libraries.length} libraries`}
            action={
              <Segmented
                label="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "score", label: "Lowest score" },
                  { value: "name", label: "Name" },
                ]}
              />
            }
            className="min-w-0"
          >
            <ul className="-mx-2 grid">
              {sorted.map((library) => (
                <li key={library.id}>
                  <button
                    onClick={() => setSelected(library.id)}
                    aria-current={library.id === selected}
                    className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left hover:bg-surface aria-[current=true]:bg-surface coarse:py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {libraryName(library)}
                      </span>
                      <span className="flex items-center gap-2 truncate text-xs text-fg-3">
                        <span className="truncate">{library.id}</span>
                        {library.private && <span>· private</span>}
                        {library.state !== "complete" && <StateLabel state={library.state} />}
                      </span>
                    </span>
                    <span className="hidden w-28 text-right text-xs whitespace-nowrap text-fg-3 tabular-nums @md:block">
                      {library.totalSnippets !== undefined &&
                        `${num(library.totalSnippets)} snippets`}
                    </span>
                    {library.benchmarkScore !== undefined ? (
                      <ScoreBar score={library.benchmarkScore} />
                    ) : (
                      <span className="w-28 text-right text-xs text-fg-3">No score</span>
                    )}
                    <IconChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
        if (wide)
          return (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-8">
              {list}
              {current ? (
                <LibraryDetail teamspace={teamspace} library={current} />
              ) : (
                <Card>
                  <Empty>Pick a library to see the questions its docs answer badly.</Empty>
                </Card>
              )}
            </div>
          );
        if (!current) return list;
        return (
          <div className="grid gap-4">
            <div>
              <Button variant="ghost" className="-ml-2" onClick={() => setSelected(undefined)}>
                <IconArrowLeft aria-hidden />
                Libraries
              </Button>
            </div>
            <LibraryDetail teamspace={teamspace} library={current} />
          </div>
        );
      }}
    </Loaded>
  );
}

function LibraryDetail({ teamspace, library }: { teamspace: string; library: Library }) {
  useEffect(() => {
    host.setModelContext(
      `The user opened the benchmark of library ${library.id} (teamspace ${teamspace}) in the Context7 console.`
    );
  }, [teamspace, library.id]);
  // The newest 60 questions: a fair sample for the chart, and under the server's
  // 80,000-character cap (100 questions with long explanations reach ~100,000).
  const result = useTool<Benchmarks>(library.owned ? "get_library_benchmarks" : undefined, {
    teamspace,
    library_id: library.id,
    order: "newest",
    limit: 60,
  });
  const lowest = useMemo(
    () => [...(result.data?.benchmarks ?? [])].sort((a, b) => a.score - b.score).slice(0, 10),
    [result.data]
  );

  return (
    <Card
      title={
        <span className="block min-w-0">
          <span className="block truncate">{libraryName(library)}</span>
          <span className="block truncate text-xs font-normal text-fg-3">{library.id}</span>
        </span>
      }
      action={
        library.owned ? (
          <ChatButton
            prompt={`Fix the docs of ${library.id} for the benchmark questions that score lowest. Use get_library_benchmarks and get_library_suggestions.`}
          >
            Fix the lowest
          </ChatButton>
        ) : undefined
      }
      className="min-w-0"
    >
      {!library.owned ? (
        <Empty>Benchmarks are shown for libraries this teamspace has claimed.</Empty>
      ) : (
        <Loaded result={result} skeleton={<MetricsSkeleton />}>
          {({ stats, benchmarks }) =>
            benchmarks.length === 0 ? (
              <Empty>No benchmark yet.</Empty>
            ) : (
              <div className="grid gap-8">
                <Metrics>
                  <Metric
                    label="Average"
                    value={Math.round(stats.averageScore ?? 0)}
                    hint={`${stats.count} questions`}
                  />
                  <Metric label="Last 10" value={Math.round(stats.averageScoreLast10 ?? 0)} />
                  <Metric
                    label="Lowest"
                    value={Math.round(stats.minScore ?? 0)}
                    tone={(stats.minScore ?? 0) < 50 ? "bad" : undefined}
                  />
                  <Metric
                    label="Last run"
                    value={
                      <span className="text-base">
                        {stats.latestBenchmarkDate ? ago(stats.latestBenchmarkDate) : "–"}
                      </span>
                    }
                  />
                </Metrics>
                <ScoreHistogram scores={benchmarks.map((b) => b.score)} />
                <div>
                  <h3 className="mb-1 text-xs font-medium text-fg-3">Lowest scores</h3>
                  <ul className="grid">
                    {lowest.map((row, i) => (
                      <li key={i} className="border-t border-divider first:border-0">
                        <details className="group">
                          <summary className="flex list-none gap-3 py-3 [&::-webkit-details-marker]:hidden">
                            <span
                              className={`w-6 shrink-0 text-sm font-semibold tabular-nums ${scoreTone(row.score)}`}
                            >
                              {Math.round(row.score)}
                            </span>
                            <span className="min-w-0 flex-1 text-sm">{row.query}</span>
                            <IconChevronRight
                              className="mt-0.5 size-4 shrink-0 text-fg-3 transition-transform group-open:rotate-90"
                              aria-hidden
                            />
                          </summary>
                          {row.explanation && (
                            <p className="pb-3 pl-9 text-sm whitespace-pre-wrap text-fg-2">
                              {row.explanation}
                            </p>
                          )}
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )
          }
        </Loaded>
      )}
    </Card>
  );
}
