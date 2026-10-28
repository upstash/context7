import {
  IconArrowUpRight,
  IconBook,
  IconBooks,
  IconChartBar,
  IconMaximize,
  IconMessageQuestion,
  IconSelector,
  IconUserSquare,
  IconUsersGroup,
  type Icon,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, ChatButton, ErrorNote, Skeleton } from "./components";
import { useTool } from "./data";
import { host, type Teamspace, type View } from "./host";
import { AskPage, AskSummary } from "./pages/ask";
import { Docs7Page, Docs7Summary } from "./pages/docs7";
import { LibrariesPage, LibrariesSummary } from "./pages/libraries";
import { UsagePage, UsageSummary } from "./pages/usage";

/*
 * Two layouts, as the Claude and OpenAI app guidelines ask:
 * - Inline (in the chat): one summary card of the page the model opened. It
 *   fits its content (no inner scroll), has no navigation, and ends in at most
 *   two actions: open the full console, and one request to the model.
 * - Fullscreen: the console with navigation, charts and lists. It also
 *   renders inline in a host that cannot go fullscreen, still at content height.
 */

type Page = {
  label: string;
  icon: Icon;
  Summary: (props: { teamspace: string }) => ReactNode;
  Full: (props: { teamspace: string; name: string }) => ReactNode;
  /** The inline card's request to the model. */
  ask: (teamspace: string) => { label: string; prompt: string };
};

const PAGES: Record<View, Page> = {
  usage: {
    label: "Usage",
    icon: IconChartBar,
    Summary: UsageSummary,
    Full: UsagePage,
    ask: (t) => ({
      label: "Explain my spend",
      prompt: `Explain the Context7 spend and usage of teamspace "${t}" this month and what drives it.`,
    }),
  },
  libraries: {
    label: "Libraries",
    icon: IconBooks,
    Summary: LibrariesSummary,
    Full: LibrariesPage,
    ask: (t) => ({
      label: "Fix the lowest",
      prompt: `Find the library of teamspace "${t}" with the lowest benchmark score and fix its docs for the questions it fails.`,
    }),
  },
  docs7: {
    label: "Docs7",
    icon: IconBook,
    Summary: Docs7Summary,
    Full: Docs7Page,
    ask: (t) => ({
      label: "Find doc gaps",
      prompt: `Find the doc gaps of the Docs7 sites of teamspace "${t}" from reader searches and feedback, and fix them in the repository.`,
    }),
  },
  ask: {
    label: "Ask",
    icon: IconMessageQuestion,
    Summary: AskSummary,
    Full: AskPage,
    ask: (t) => ({
      label: "Fill gaps",
      prompt: `Add answers to the docs for the unanswered questions of the Ask sites of teamspace "${t}".`,
    }),
  },
};
const VIEWS = Object.keys(PAGES) as View[];

/** The teamspace the model asked for, by id or name, else the first non-personal one. */
function pickTeamspace(teamspaces: Teamspace[], wanted?: string) {
  const want = wanted?.trim().toLowerCase();
  return (
    teamspaces.find((t) => t.id === wanted || t.name.toLowerCase() === want) ??
    teamspaces.find((t) => !t.isPersonal) ??
    teamspaces[0]
  );
}

export function App() {
  // Re-renders on host context (theme, display mode) and on each open_console call.
  useSyncExternalStore(host.subscribe, () => host.opened);
  useSyncExternalStore(host.subscribe, () => host.context);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("usage");
  // The user's pick, kept with the open_console call it was made under: a new call resets it.
  const [picked, setPicked] = useState<{ id: string; under?: object }>();
  const [noCall, setNoCall] = useState(false);
  const { open } = host.opened;

  useEffect(() => {
    void host.connect().then(() => setReady(true));
  }, []);

  // ChatGPT's sidebar and side-panel entrypoints open the page with no call first. After a call,
  // its input arrives right after the handshake; list the teamspaces only when none came.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setNoCall(!host.opened.open && !host.opened.teamspaces), 800);
    return () => clearTimeout(timer);
  }, [ready]);
  const listed = useTool<{ teamspaces: Teamspace[] }>(
    noCall && !host.opened.teamspaces ? "list_teamspaces" : undefined
  );
  const teamspaces = host.opened.teamspaces ?? listed.data?.teamspaces;

  // A new open_console call moves the page to the view it names.
  useEffect(() => {
    if (open?.view) setView(open.view);
  }, [open]);

  const teamspace = teamspaces
    ? ((picked?.under === open ? teamspaces.find((t) => t.id === picked?.id) : undefined) ??
      pickTeamspace(teamspaces, open?.teamspace))
    : undefined;
  const full = host.fullscreen || !host.canFullscreen;

  if (listed.error && !teamspaces)
    return (
      <div className="p-4">
        <ErrorNote message={listed.error} onRetry={listed.reload} />
      </div>
    );
  if (!ready || !teamspaces) return <Loading full={full} />;
  if (!teamspace) return <p className="p-4 text-sm text-fg-3">No teamspace for this sign-in.</p>;

  return full ? (
    <Console
      view={view}
      onView={setView}
      teamspace={teamspace}
      teamspaces={teamspaces}
      onTeamspace={(id) => setPicked({ id, under: open })}
    />
  ) : (
    <InlineCard view={view} teamspace={teamspace} />
  );
}

function InlineCard({ view, teamspace }: { view: View; teamspace: Teamspace }) {
  const page = PAGES[view];
  const ask = page.ask(teamspace.name);
  useEffect(() => {
    host.setModelContext(
      `The Context7 console shows the user a ${page.label} summary of teamspace "${teamspace.name}" (${teamspace.id}).`
    );
  }, [page, teamspace]);
  return (
    <div className="@container grid gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <page.icon className="size-5 stroke-[1.5] text-accent-text" aria-hidden />
          {page.label}
        </h1>
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg-3">
          <TeamspaceIcon teamspace={teamspace} />
          <span className="truncate">{teamspace.name}</span>
        </span>
      </header>
      <page.Summary teamspace={teamspace.id} />
      <footer className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => host.requestDisplayMode("fullscreen").catch(() => {})}
        >
          <IconMaximize aria-hidden />
          Open console
        </Button>
        <ChatButton prompt={ask.prompt}>{ask.label}</ChatButton>
      </footer>
    </div>
  );
}

function TeamspaceIcon({ teamspace }: { teamspace: Teamspace }) {
  const Glyph = teamspace.isPersonal ? IconUserSquare : IconUsersGroup;
  return <Glyph className="size-5 shrink-0 stroke-[1.5] text-fg-3" aria-hidden />;
}

/**
 * The dashboard's teamspace switcher (context7app DashboardDropdown): a bordered trigger with
 * the name, and a 280px panel with the current teamspace first in emerald. Fullscreen only, so
 * the host never clips it.
 */
function TeamspaceMenu({
  teamspace,
  teamspaces,
  onTeamspace,
}: {
  teamspace: Teamspace;
  teamspaces: Teamspace[];
  onTeamspace: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const ordered = [teamspace, ...teamspaces.filter((t) => t.id !== teamspace.id)];
  const row =
    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-base font-medium text-fg coarse:py-3";

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        aria-label={`Teamspace: ${teamspace.name}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-line px-3 text-base font-medium text-fg hover:border-stone-400 dark:hover:border-stone-500 @2xl:min-w-[196px]"
      >
        <span className="max-w-[160px] truncate">{teamspace.name}</span>
        <IconSelector className="ml-auto size-[18px] shrink-0 stroke-[1.5] text-fg-3" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="group"
            aria-label="Teamspaces"
            className="absolute left-0 z-50 mt-2 max-h-[min(420px,70vh)] w-[280px] overflow-y-auto rounded-xl border border-line bg-bg p-2 shadow-xl"
          >
            {ordered.map((t) => (
              <button
                key={t.id}
                aria-pressed={t.id === teamspace.id}
                onClick={() => {
                  onTeamspace(t.id);
                  setOpen(false);
                }}
                className={`${row} ${t.id === teamspace.id ? "bg-accent-soft hover:bg-accent-soft-hover" : "hover:bg-surface"}`}
              >
                <span className="truncate">{t.name}</span>
                <TeamspaceIcon teamspace={t} />
              </button>
            ))}
            <div className="py-2">
              <div className="border-b border-line" />
            </div>
            <button
              onClick={() => {
                setOpen(false);
                host.openLink("https://context7.com/dashboard");
              }}
              className={`${row} font-normal text-accent-text hover:bg-accent-soft`}
            >
              Open dashboard
              <IconArrowUpRight className="size-4 stroke-[1.5]" aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** The fullscreen console: the dashboard's header bar, its underline tabs, then the page. */
function Console({
  view,
  onView,
  teamspace,
  teamspaces,
  onTeamspace,
}: {
  view: View;
  onView: (view: View) => void;
  teamspace: Teamspace;
  teamspaces: Teamspace[];
  onTeamspace: (id: string) => void;
}) {
  const page = PAGES[view];
  return (
    <div className="@container flex h-full flex-col bg-page">
      <header className="z-30 shrink-0 bg-bg shadow-[0px_1px_2px_rgba(0,0,0,0.08)]">
        {/* No logo: the host already shows the app's name and icon (OpenAI app guidelines). */}
        <div className="flex h-16 items-center justify-between gap-3 px-4 @2xl:px-8">
          <TeamspaceMenu teamspace={teamspace} teamspaces={teamspaces} onTeamspace={onTeamspace} />
          <Button variant="ghost" onClick={() => host.openLink("https://context7.com/dashboard")}>
            Dashboard
            <IconArrowUpRight aria-hidden />
          </Button>
        </div>
        <nav
          aria-label="Console pages"
          className="relative mx-auto flex w-full max-w-[1060px] overflow-x-auto @2xl:justify-center"
        >
          <div className="relative flex min-w-max">
            <div
              className="absolute right-2 bottom-0 left-2 h-px bg-line @2xl:right-4 @2xl:left-4"
              aria-hidden
            />
            {VIEWS.map((id) => {
              const { label, icon: Glyph } = PAGES[id];
              const active = id === view;
              return (
                <button
                  key={id}
                  onClick={() => onView(id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2 px-3 py-3 text-sm transition-colors duration-200 @2xl:px-4 @2xl:text-base ${active ? "text-accent-text" : "text-fg-2 hover:text-fg"}`}
                >
                  <Glyph className="size-[18px] stroke-[1.5]" aria-hidden />
                  {label}
                  {active && (
                    <span
                      className="absolute right-2 bottom-0 left-2 h-0.5 bg-accent-text @2xl:right-4 @2xl:left-4"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </header>
      <main className="@container min-h-0 grow overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1060px] gap-8 px-4 py-6 @2xl:px-8 @2xl:py-10">
          <page.Full key={teamspace.id} teamspace={teamspace.id} name={teamspace.name} />
        </div>
      </main>
    </div>
  );
}

function Loading({ full }: { full: boolean }) {
  return (
    <div className="grid gap-4 p-4" aria-busy="true" aria-label="Opening the Context7 console">
      <Skeleton className="h-5 w-32" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      {full && <Skeleton className="h-40" />}
      <Skeleton className="h-8 w-36" />
    </div>
  );
}
