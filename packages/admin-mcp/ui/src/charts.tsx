import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Small dependency-free SVG charts. Daily bars (one or two stacked series) read
 * out the hovered or focused day above the plot, so no value depends on a
 * tooltip; the arrow keys move along the days. Ranked rows carry a quiet bar
 * behind the label. Colors are the accent pair from styles.css.
 */

export type DayPoint = { date: string; values: number[] };
export type SeriesDef = { name: string; color: string };

/** The dashboard usage chart's colors: emerald-500, then emerald-300. */
export const SERIES = ["var(--c7-series-1)", "var(--c7-series-2)"];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry!.contentRect.width))
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The axis maximum: the next of 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 (× a power of ten). */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const n = value / exp;
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => n <= step) ?? 10) * exp;
}

/** "Oct 23", or "14:00" for an hourly key ("2026-10-23 14:00"). */
export const dayLabel = (date: string) =>
  date.length > 10
    ? date.slice(11, 16)
    : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });

export function DailyBars({
  points,
  series,
  format,
  height = 200,
}: {
  points: DayPoint[];
  series: SeriesDef[];
  format: (value: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const n = points.length;
  const shown = hover !== undefined && hover < n ? hover : undefined;
  const totals = points.map((p) => p.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const left = 40;
  const bottom = 20;
  const plotW = Math.max(0, width - left);
  const plotH = height - bottom - 4;
  const slot = n ? plotW / n : 0;
  const barW = Math.max(2, Math.min(28, slot * 0.66));
  const y = (v: number) => 4 + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
  const point = shown !== undefined ? points[shown] : undefined;
  const sums = series.map((_, s) => points.reduce((a, p) => a + (p.values[s] ?? 0), 0));

  return (
    <div>
      <div className="mb-2 flex min-h-5 flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-fg-3">
        <span className="font-medium text-fg-2 tabular-nums">
          {point ? dayLabel(point.date) : `${n} days`}
        </span>
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
            {s.name}
            <span className="font-medium text-fg tabular-nums">
              {format(point ? (point.values[i] ?? 0) : (sums[i] ?? 0))}
            </span>
          </span>
        ))}
      </div>
      <div
        ref={ref}
        tabIndex={0}
        role="img"
        aria-label={`Daily chart of ${series.map((s) => s.name).join(" and ")} over ${n} days. Use the arrow keys to read each day.`}
        className="rounded-sm"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const step = event.key === "ArrowLeft" ? -1 : 1;
          setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + step)));
        }}
        onBlur={() => setHover(undefined)}
      >
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className="block overflow-visible"
            onPointerLeave={() => setHover(undefined)}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={left}
                  x2={width}
                  y1={y(max * f)}
                  y2={y(max * f)}
                  stroke="var(--c7-line)"
                  strokeDasharray={f ? "2 4" : undefined}
                />
                <text
                  x={left - 8}
                  y={y(max * f) + 3.5}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--c7-fg-3)"
                  className="tabular-nums"
                >
                  {format(max * f)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = left + i * slot + (slot - barW) / 2;
              let base = 0;
              return (
                <g
                  key={p.date}
                  opacity={shown === undefined || shown === i ? 1 : 0.35}
                  onPointerEnter={() => setHover(i)}
                  className="transition-opacity duration-150"
                >
                  <rect x={left + i * slot} y={0} width={slot} height={height} fill="transparent" />
                  {p.values.map((v, s) => {
                    const top = y(base + v);
                    const h = y(base) - top;
                    base += v;
                    const last = p.values.slice(s + 1).every((rest) => !rest);
                    return h > 0 ? (
                      <path
                        key={s}
                        d={barPath(x, top, barW, h, last ? Math.min(3, barW / 2) : 0)}
                        fill={series[s]?.color}
                      />
                    ) : null;
                  })}
                  {i % labelEvery === 0 && (
                    <text
                      x={x + barW / 2}
                      y={height - 4}
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--c7-fg-3)"
                    >
                      {dayLabel(p.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/** A bar with rounded top corners only. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

/** A quiet trend line for an inline card: no axes, no interaction. */
export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const line = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(i * step).toFixed(1)},${(2 + (1 - v / max) * (height - 4)).toFixed(1)}`
    )
    .join("");
  return (
    <div ref={ref} aria-hidden>
      {width > 0 && values.length > 1 && (
        <svg width={width} height={height} className="block">
          <path
            d={`${line}L${width},${height}L0,${height}Z`}
            fill="var(--c7-series-1)"
            opacity="0.1"
          />
          <path
            d={line}
            fill="none"
            stroke="var(--c7-series-1)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

/** Ranked rows with a quiet bar behind each count: top paths, crawlers, questions. */
export function RankedList({
  rows,
  format = (v) => v.toLocaleString(),
  empty = "Nothing in this window.",
}: {
  rows: { key: string; label: ReactNode; value: number; note?: ReactNode }[];
  format?: (value: number) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-2 text-sm text-fg-3">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="grid gap-1">
      {rows.map((row) => (
        <li key={row.key} className="relative flex h-10 items-center gap-3 rounded-md px-3">
          <span
            className="absolute inset-y-0 left-0 rounded-md bg-accent-soft"
            style={{ width: `${(row.value / max) * 100}%` }}
            aria-hidden
          />
          <span className="relative min-w-0 flex-1 truncate text-sm">
            {row.label}
            {row.note && <span className="ml-2 text-xs text-bad">{row.note}</span>}
          </span>
          <span className="relative text-sm text-fg-2 tabular-nums">{format(row.value)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Scores 0–100 in ten buckets, red below 50, amber below 80, green above. */
export function ScoreHistogram({ scores }: { scores: number[] }) {
  const buckets = Array.from(
    { length: 10 },
    (_, i) => scores.filter((s) => Math.min(9, Math.floor(s / 10)) === i).length
  );
  const max = Math.max(1, ...buckets);
  return (
    <div
      className="flex h-16 items-end gap-1"
      role="img"
      aria-label={`Score distribution of ${scores.length} questions: ${buckets.map((c, i) => `${i * 10}s ${c}`).join(", ")}`}
    >
      {buckets.map((count, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end gap-1">
          <div
            className={`w-full rounded-t-[3px] ${i < 5 ? "bg-score-bad" : i < 8 ? "bg-score-warn" : "bg-score-good"}`}
            style={{ height: `${Math.max(3, (count / max) * 80)}%`, opacity: count ? 0.8 : 0.15 }}
          />
          <span className="text-center text-[10px] leading-none text-fg-3 tabular-nums">
            {i * 10}
          </span>
        </div>
      ))}
    </div>
  );
}
