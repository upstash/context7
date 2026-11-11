import { IconArrowLeft, IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
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
import { useTool, type Benchmarks, type Library, type LibraryList } from "../data";
import { ago, num } from "../format";
import { host } from "../host";

const libraryName = (library: Library) => library.title ?? library.id;

export function LibrariesSummary({ teamspace }: { teamspace: string }) {
  const result = useTool<LibraryList>("list_libraries", { teamspace, order: "lowest" });
  return (
    <Loaded result={result} skeleton={<RowsSkeleton rows={4} />}>
      {({ total, parsing, failed, libraries }) => {
        if (total === 0) return <Empty>No private or claimed libraries yet.</Empty>;
        const scored = libraries.filter((l) => l.benchmarkScore !== undefined);
        return (
          <div className="grid gap-4">
            <p className="text-sm text-fg-2">
              {num(total)} libraries
              {parsing > 0 && ` · ${parsing} parsing`}
              {failed > 0 && <span className="text-bad"> · {failed} failed</span>}
            </p>
            {scored.length > 0 && (
              <ol className="grid">
                {scored.slice(0, 4).map((library) => (
                  <li
                    key={library.id}
                    className="flex items-center gap-3 border-t border-line py-3 first:border-0"
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

export function LibrariesPage({ teamspace }: { teamspace: string }) {
  const [sort, setSort] = useState<"score" | "name">("score");
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(typed.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  // list_libraries sorts and pages (50 a page), so a large teamspace stays under the result cap.
  const result = useTool<LibraryList>("list_libraries", {
    teamspace,
    order: sort === "score" ? "lowest" : "name",
    page,
    ...(search && { search }),
  });
  // Kept as the row, so the detail stays open on another page or search.
  const [current, setCurrent] = useState<Library>();
  // Wide: list and detail side by side. Narrow: the detail replaces the list, with Back.
  const wide = useWide(896);
  const searchable = Boolean(search) || (result.data?.pages ?? 1) > 1;
  useEffect(() => {
    if (!current)
      host.setModelContext(
        `The user is looking at the libraries of teamspace ${teamspace} in the Context7 console.`
      );
  }, [teamspace, current]);

  const list = (
    <Card
      title={
        result.data
          ? search
            ? `${num(result.data.total)} matches`
            : `${num(result.data.total)} libraries`
          : "Libraries"
      }
      action={
        <Segmented
          label="Sort"
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPage(1);
          }}
          options={[
            { value: "score", label: "Lowest score" },
            { value: "name", label: "Name" },
          ]}
        />
      }
      className="min-w-0"
    >
      <div className="grid gap-4">
        {searchable && (
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 coarse:h-11">
            <IconSearch className="size-4 shrink-0 text-fg-3" aria-hidden />
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Search by id, title or source"
              aria-label="Search libraries"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
            />
          </label>
        )}
        <Loaded result={result} skeleton={<RowsSkeleton rows={6} />}>
          {({ libraries, pages }) =>
            libraries.length === 0 ? (
              <Empty>
                {search
                  ? "No library matches."
                  : "No private or claimed libraries yet. Add one with add_library or claim one with claim_library."}
              </Empty>
            ) : (
              <div className="grid gap-4">
                <ul className="-mx-2 grid">
                  {libraries.map((library) => (
                    <li key={library.id}>
                      <LibraryRow
                        library={library}
                        current={library.id === current?.id}
                        onOpen={() => setCurrent(library)}
                      />
                    </li>
                  ))}
                </ul>
                {pages > 1 && (
                  <div className="flex items-center justify-between gap-3 text-xs text-fg-3">
                    <Button
                      variant="ghost"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <IconChevronLeft aria-hidden />
                      Previous
                    </Button>
                    <span className="tabular-nums">
                      Page {page} of {pages}
                    </span>
                    <Button
                      variant="ghost"
                      disabled={page >= pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                      <IconChevronRight aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            )
          }
        </Loaded>
      </div>
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
        <Button variant="ghost" className="-ml-2" onClick={() => setCurrent(undefined)}>
          <IconArrowLeft aria-hidden />
          Libraries
        </Button>
      </div>
      <LibraryDetail teamspace={teamspace} library={current} />
    </div>
  );
}

function LibraryRow({
  library,
  current,
  onOpen,
}: {
  library: Library;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      aria-current={current}
      className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left hover:bg-surface aria-[current=true]:bg-surface coarse:py-3"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{libraryName(library)}</span>
        <span className="flex items-center gap-2 truncate text-xs text-fg-3">
          <span className="truncate">{library.id}</span>
          {library.private && <span>· private</span>}
          {library.state !== "complete" && <StateLabel state={library.state} />}
        </span>
      </span>
      <span className="hidden w-28 text-right text-xs whitespace-nowrap text-fg-3 tabular-nums @md:block">
        {library.totalSnippets !== undefined && `${num(library.totalSnippets)} snippets`}
      </span>
      {library.benchmarkScore !== undefined ? (
        <ScoreBar score={library.benchmarkScore} />
      ) : (
        <span className="w-28 text-right text-xs text-fg-3">No score</span>
      )}
      <IconChevronRight className="size-4 shrink-0 text-fg-3" aria-hidden />
    </button>
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
  // The lowest 10 of all questions, not of the newest 60: an old failing one still shows.
  const lowest = useTool<Benchmarks>(library.owned ? "get_library_benchmarks" : undefined, {
    teamspace,
    library_id: library.id,
    order: "lowest",
    limit: 10,
  });

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
                  <Loaded result={lowest} skeleton={<RowsSkeleton rows={4} />}>
                    {(low) => (
                      <ul className="grid">
                        {low.benchmarks.map((row, i) => (
                          <li key={i} className="border-t border-line first:border-0">
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
                    )}
                  </Loaded>
                </div>
              </div>
            )
          }
        </Loaded>
      )}
    </Card>
  );
}
