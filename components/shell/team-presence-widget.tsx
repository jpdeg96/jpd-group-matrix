"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserChip } from "@/components/ui/primitives";
import { api } from "@/lib/ui/api-client";
import { formatPlainDateWithWeekday, type PlainDate } from "@/lib/date/plain-date";

interface TeamPresence {
  userId: string;
  userName: string;
  userColor: string;
  eventId: string;
  context: "DASHBOARD" | "C1";
  startedAt: string;
  minutesActive: number;
  label: string;
  eventDate: PlainDate;
  venue: string | null;
}

/**
 * How often the chip re-reads.
 *
 * Matched to the client heartbeat, so somebody starting work shows up within
 * about half a minute. Faster would be a live feed nobody asked for; the tables
 * already have SSE for the rows actually in front of you.
 */
const REFRESH_MS = 30_000;

/** Above this, a claim is old enough to be worth a second look. */
const LONG_RUNNING_MINUTES = 120;

/**
 * "Who is working on what", for managers and administrators.
 *
 * The information existed but only in pieces: each table shows presence for the
 * rows on that table, so answering "what is everyone doing" meant opening the
 * Dashboard, opening C1, and holding both in your head. This is the whole
 * picture in one place, ordered oldest claim first — the entry worth noticing
 * is the one that has been open longest.
 *
 * Every row is a link to the event itself. The point of knowing somebody has
 * been on something for three hours is being able to go and look at it, and a
 * list that names an event without taking you there just moves the search.
 */
export function TeamPresenceWidget() {
  const router = useRouter();
  const [entries, setEntries] = React.useState<TeamPresence[]>([]);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{ presence: TeamPresence[] }>("/api/presence/team");
      setEntries(data.presence);
    } catch {
      // Ambient: a failed poll keeps the last known state rather than claiming
      // everybody stopped working.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);

    // The tables fire this on Start and Stop, so the chip reacts to a click
    // in this tab rather than waiting out the poll.
    const onChanged = () => void load();
    window.addEventListener("jpd:presence-changed", onChanged);

    return () => {
      clearInterval(timer);
      window.removeEventListener("jpd:presence-changed", onChanged);
    };
  }, [load]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = entries.length > 0;

  // One person on three events is one person working, not three.
  const peopleCount = new Set(entries.map((entry) => entry.userId)).size;

  function jumpTo(entry: TeamPresence) {
    setOpen(false);
    const screen = entry.context === "C1" ? "/c1" : "/dashboard";
    router.push(`${screen}?focus=${entry.eventId}`);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={
          active
            ? `${peopleCount} ${peopleCount === 1 ? "person is" : "people are"} working right now. Click for details.`
            : "Nobody is marked as working right now."
        }
        className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition"
        style={{
          borderColor: active ? "transparent" : "var(--line-strong)",
          background: active ? "var(--live-soft)" : "transparent",
          color: active ? "var(--live)" : "var(--ink-muted)",
        }}
      >
        <span
          aria-hidden
          className={active ? "jpd-live-dot h-2 w-2 rounded-full" : "h-2 w-2 rounded-full"}
          style={{ background: active ? "var(--live)" : "var(--ink-subtle)" }}
        />
        Team
        <span className="tabular-nums opacity-80">{peopleCount}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[24rem] overflow-y-auto rounded-md border p-1 shadow-xl scrollbar-thin"
          style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}
        >
          <p className="px-2 py-1.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            {active
              ? "Marked as in progress right now. Oldest first — click one to open the event."
              : "Nobody is marked as in progress."}
          </p>

          {entries.map((entry) => {
            const stale = entry.minutesActive >= LONG_RUNNING_MINUTES;

            return (
              <button
                key={`${entry.userId}:${entry.eventId}:${entry.context}`}
                type="button"
                role="menuitem"
                onClick={() => jumpTo(entry)}
                title={`Open this event on the ${entry.context === "C1" ? "C1" : "Dashboard"}`}
                className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left transition hover:brightness-95"
                style={{ background: "transparent" }}
              >
                <span className="min-w-0 flex-1">
                  <UserChip
                    name={entry.userName}
                    color={entry.userColor}
                    className="text-[11.5px] font-medium"
                  />
                  <span className="mt-0.5 block truncate text-[12px]">{entry.label}</span>
                  <span
                    className="block truncate text-[10.5px]"
                    style={{ color: "var(--ink-subtle)" }}
                  >
                    {formatPlainDateWithWeekday(entry.eventDate)}
                    {entry.venue ? ` · ${entry.venue}` : ""}
                    {entry.context === "C1" ? " · C1" : ""}
                  </span>
                </span>

                <span
                  className="shrink-0 rounded px-1.5 py-px text-[11px] font-semibold tabular-nums"
                  style={
                    stale
                      ? { background: "var(--warn-soft)", color: "var(--warn)" }
                      : { background: "var(--live-soft)", color: "var(--live)" }
                  }
                >
                  {formatElapsed(entry.minutesActive)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Elapsed time, in the largest unit that still reads honestly.
 *
 * Minutes past an hour or two stop being information — "3h 47m" and "3h" lead
 * to the same conversation, and the shorter one fits the chip.
 */
function formatElapsed(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours < 4 && rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}
