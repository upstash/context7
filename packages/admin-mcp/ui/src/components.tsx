import { IconMessage, IconRefresh } from "@tabler/icons-react";
import { useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { host } from "./host";

/*
 * The page's primitives in the Context7 dashboard's style (context7app
 * components/ui and Docs7Kit): emerald primary buttons, rounded-3xl cards, a
 * stats strip, pill tabs and status pills. Touch screens get 44px targets.
 */

type ButtonVariant = "primary" | "secondary" | "ghost" | "ghostPrimary";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export function Button({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3.5 text-sm whitespace-nowrap transition-colors coarse:h-11 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]",
        variant === "primary" && "bg-accent text-white hover:bg-emerald-700",
        variant === "secondary" && "border border-line bg-bg text-fg hover:bg-surface",
        variant === "ghost" && "text-fg hover:bg-surface",
        variant === "ghostPrimary" &&
          "border border-accent-line bg-accent-soft text-accent-text hover:bg-accent-soft-hover",
        className
      )}
      {...props}
    />
  );
}

/**
 * Hands a request to the model as the user's next message: anything that needs
 * language or a reply goes through the chat, not through the page (Claude and
 * OpenAI guidelines). Hidden when the host takes no messages.
 */
export function ChatButton({ prompt, children }: { prompt: string; children: ReactNode }) {
  if (!host.canMessage) return null;
  return (
    <Button variant="ghostPrimary" onClick={() => host.sendMessage(prompt).catch(() => {})}>
      <IconMessage aria-hidden />
      {children}
    </Button>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx("rounded-3xl border border-line bg-bg p-6 shadow-sm @2xl:p-8", className)}
    >
      {(title || action) && (
        <header className="mb-6 flex min-h-9 items-center justify-between gap-4">
          <h2 className="min-w-0 text-lg font-semibold">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "bad" | "warn";
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm text-fg-3 uppercase">{label}</div>
      <div
        className={cx(
          "mt-1 truncate text-lg font-medium tabular-nums",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
          tone === "warn" && "text-warn"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-sm text-fg-3">{hint}</div>}
    </div>
  );
}

/** The dashboard's stats strip: four cells with dividers, two columns on a narrow frame. */
export function Metrics({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-6 @2xl:grid-cols-4 @2xl:gap-0 @2xl:[&>*]:border-r @2xl:[&>*]:border-line @2xl:[&>*]:px-8 @2xl:[&>*:first-child]:pl-0 @2xl:[&>*:last-child]:border-r-0 @2xl:[&>*:last-child]:pr-0">
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-9 shrink-0 items-center rounded-lg bg-surface p-1 text-fg-3 coarse:h-11"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            "h-full rounded-md px-3 text-sm tabular-nums transition-colors",
            option.value === value ? "bg-bg text-fg shadow" : "hover:text-fg"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Choose one of a few items (sites): the selected one in emerald, as the dashboard's selection. */
export function Chips({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            "h-8 max-w-64 truncate rounded-lg border px-3 text-sm coarse:h-11",
            option.value === value
              ? "border-accent-line bg-accent-soft font-medium text-accent-text"
              : "border-line text-fg-2 hover:bg-surface hover:text-fg"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Spend against a cap, or requests against a quota. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-1 overflow-hidden rounded-full bg-surface"
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500",
          share >= 0.9 ? "bg-score-bad" : share >= 0.75 ? "bg-score-warn" : "bg-series-1"
        )}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

/** Docs7Kit's StatusPill tones: dot color and text color by state. */
const STATE_TONE: Record<string, [dot: string, text: string]> = {
  complete: ["bg-emerald-500", "text-emerald-800 dark:text-emerald-400"],
  succeeded: ["bg-emerald-500", "text-emerald-800 dark:text-emerald-400"],
  ready: ["bg-emerald-500", "text-emerald-800 dark:text-emerald-400"],
  error: ["bg-red-500", "text-red-800 dark:text-red-400"],
  failed: ["bg-red-500", "text-red-800 dark:text-red-400"],
  processing: ["bg-amber-500", "text-amber-800 dark:text-amber-500"],
  finalizing: ["bg-amber-500", "text-amber-800 dark:text-amber-500"],
  building: ["bg-blue-500", "text-blue-800 dark:text-blue-400"],
  submitted: ["bg-blue-500", "text-blue-800 dark:text-blue-400"],
};
const MUTED_TONE: [string, string] = [
  "bg-stone-400 dark:bg-stone-500",
  "text-stone-800 dark:text-stone-300",
];

/** A state as the Docs7 status pill: a bordered pill with a colored dot. */
export function StateLabel({ state }: { state: string }) {
  const [dot, text] = STATE_TONE[state] ?? MUTED_TONE;
  return (
    <span
      className={cx(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-line bg-bg px-2 py-1 text-xs leading-none font-medium whitespace-nowrap capitalize",
        text
      )}
    >
      <span className={cx("size-2 shrink-0 rounded-full", dot)} aria-hidden />
      {state}
    </span>
  );
}

export const scoreTone = (score: number) =>
  score >= 80 ? "text-good" : score >= 50 ? "text-warn" : "text-bad";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** Placeholder metrics and a chart block, the shape most pages load into. */
export function MetricsSkeleton({ chart = true }: { chart?: boolean }) {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading">
      <Metrics>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </Metrics>
      {chart && <Skeleton className="h-36 w-full" />}
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5" />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  // The first line is the tool's own explanation; the rest is the API body for the model.
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm dark:border-red-900/70 dark:bg-red-950/40">
      <span className="text-red-700 dark:text-red-400">{message.split("\n")[0]}</span>
      {onRetry && (
        <Button variant="ghost" className="-my-1.5 h-7" onClick={onRetry}>
          <IconRefresh aria-hidden />
          Retry
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-fg-3">{children}</p>;
}

/** Data with its skeleton and error states. */
export function Loaded<T>({
  result,
  skeleton,
  children,
}: {
  result: { data?: T; error?: string; reload: () => void };
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (result.error) return <ErrorNote message={result.error} onRetry={result.reload} />;
  if (result.data === undefined) return <>{skeleton}</>;
  return <>{children(result.data)}</>;
}

const subscribeResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

/** The frame is at least this wide (the iframe's width is the page's container). */
export function useWide(minWidth: number) {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth >= minWidth);
}
