"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { formatDurationClock, formatDurationShort } from "@/lib/clockify/duration";
import { formatBusinessTime } from "@/lib/date/business-time";
import { useClockNotifications } from "./use-clock-notifications";

interface ClockifySummary {
  enabled: boolean;
  error: string | null;
  linked: boolean;
  runningSeconds: number | null;
  runningSince: string | null;
  runningDescription: string | null;
  todaySeconds: number;
  weekSeconds: number;
  clockedIn: Array<{
    userId: string;
    displayName: string;
    color: string;
    since: string;
    seconds: number;
    description: string | null;
  }>;
}

/**
 * How often we re-ask Clockify.
 *
 * This is also the notification latency: clocking in happens in Clockify, so a
 * transition can only be noticed on the next poll. Sixty seconds was fine while
 * the chip was purely ambient and reads badly once it is announcing things, so
 * it is halved.
 *
 * The cost is real but small: each poll asks Clockify once for the viewer and
 * once per other linked person, *per open tab*. At a handful of people that is
 * far below Clockify's rate limit; it would need rethinking as a shared
 * server-side poll long before this team outgrew it.
 */
const REFRESH_MS = 30_000;

/**
 * Clockify time chip.
 *
 * Shows the running timer, today's and this week's totals, and who else is on
 * the clock. Renders nothing at all when the integration is switched off, so
 * teams that do not use Clockify never see a broken or empty control.
 *
 * The running timer ticks locally between refreshes rather than polling every
 * second — the same number, a sixtieth of the API calls.
 */
export function ClockifyWidget() {
  const [summary, setSummary] = React.useState<ClockifySummary | null>(null);
  const [tick, setTick] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Announces clock-in / clock-out as toasts, for the viewer and for everyone
  // else. Driven by the same poll that feeds the chip, so it costs no extra
  // requests.
  useClockNotifications(summary);

  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await api.get<{ clockify: ClockifySummary }>("/api/clockify");
        if (!cancelled) setSummary(data.clockify);
      } catch {
        // Ambient widget: a failed poll just leaves the last known state.
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Local 1s tick so a running timer counts up smoothly.
  React.useEffect(() => {
    if (summary?.runningSeconds === null || summary?.runningSeconds === undefined) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [summary?.runningSeconds]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!summary?.enabled) return null;

  const running = summary.runningSeconds !== null;
  const liveSeconds = running ? (summary.runningSeconds ?? 0) + tick : 0;
  const liveToday = summary.todaySeconds + (running ? tick : 0);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={
          summary.error
            ? summary.error
            : running
              ? "You are clocked in. Click for details."
              : "Clocked out. Click for details."
        }
        className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition"
        style={{
          borderColor: running ? "transparent" : "var(--line-strong)",
          background: running ? "var(--live-soft)" : "transparent",
          color: running ? "var(--live)" : "var(--ink-muted)",
        }}
      >
        <span
          aria-hidden
          className={cn("h-2 w-2 rounded-full", running && "jpd-live-dot")}
          style={{ background: running ? "var(--live)" : "var(--ink-subtle)" }}
        />
        {summary.error ? (
          "Time unavailable"
        ) : !summary.linked ? (
          "Not linked"
        ) : running ? (
          <span className="tabular-nums">{formatDurationClock(liveSeconds)}</span>
        ) : (
          <span className="tabular-nums">{formatDurationShort(liveToday)}</span>
        )}
      </button>

      {open ? (
        <div
          className="absolute right-0 z-50 mt-1 w-72 rounded-md border p-3 shadow-xl"
          style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}
        >
          {summary.error ? (
            <p className="text-[12px]" style={{ color: "var(--danger)" }}>
              {summary.error}
            </p>
          ) : !summary.linked ? (
            <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              Your account is not linked to a Clockify user yet. An administrator
              can set that under Users.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat
                  label="Session"
                  value={running ? formatDurationClock(liveSeconds) : "—"}
                  live={running}
                />
                <Stat label="Today" value={formatDurationShort(liveToday)} />
                <Stat
                  label="This week"
                  value={formatDurationShort(summary.weekSeconds + (running ? tick : 0))}
                />
              </div>

              {running && summary.runningSince ? (
                <p className="mt-2 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                  Started {formatBusinessTime(summary.runningSince)}
                  {summary.runningDescription ? ` · ${summary.runningDescription}` : ""}
                </p>
              ) : null}
            </>
          )}

          <div
            className="mt-3 border-t pt-2"
            style={{ borderColor: "var(--line)" }}
          >
            <p
              className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--ink-subtle)" }}
            >
              Clocked in now
            </p>
            {summary.clockedIn.length === 0 ? (
              <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
                Nobody else is on the clock.
              </p>
            ) : (
              <ul className="space-y-1">
                {summary.clockedIn.map((entry) => (
                  <li
                    key={entry.userId}
                    className="flex items-center justify-between gap-2 text-[11.5px]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden
                        className="jpd-live-dot h-2 w-2 shrink-0 rounded-full"
                        style={{ background: entry.color }}
                      />
                      <span className="truncate">{entry.displayName}</span>
                    </span>
                    <span
                      className="shrink-0 tabular-nums"
                      style={{ color: "var(--ink-subtle)" }}
                    >
                      {formatDurationShort(entry.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <div>
      <div
        className="text-[14px] font-semibold tabular-nums"
        style={{ color: live ? "var(--live)" : "var(--ink)" }}
      >
        {value}
      </div>
      <div className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
        {label}
      </div>
    </div>
  );
}
