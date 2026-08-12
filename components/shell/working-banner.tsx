"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";

interface MyPresence {
  eventId: string;
  context: "DASHBOARD" | "C1";
  startedAt: string;
  minutesActive: number;
  label: string;
}

/** Matches the server's expiry sweep comfortably. */
const HEARTBEAT_MS = 30_000;

/** Slow: the banner is confirmation, not a live feed. */
const REFRESH_MS = 60_000;

/**
 * "You are working on …", carried across every screen.
 *
 * Lives in the app shell rather than in either table, for two reasons.
 *
 * The heartbeat has to outlive navigation. It used to run inside `usePresence`,
 * which unmounts the moment you leave the Dashboard — and worse, its cleanup
 * sent a CLEAR, so walking to C1 dropped every claim. Owning it here means a
 * claim survives until it is deliberately stopped or the server expires it.
 *
 * And a claim you cannot see is a claim you forget to release. Once presence
 * legitimately outlives the page that created it, it needs somewhere to be
 * visible from — otherwise the first time you notice is a colleague asking why
 * an event has been "in progress" since Tuesday.
 */
export function WorkingBanner() {
  const [entries, setEntries] = React.useState<MyPresence[]>([]);
  const [stopping, setStopping] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{ presence: MyPresence[] }>("/api/presence/mine");
      setEntries(data.presence);
    } catch {
      // Ambient: a failed poll leaves the last known state rather than
      // implying the claim was dropped.
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(load, REFRESH_MS);

    // The tables fire this the instant you press Start or Stop, so the banner
    // reacts to the click instead of waiting out the poll.
    const onChanged = () => void load();
    window.addEventListener("jpd:presence-changed", onChanged);

    return () => {
      clearInterval(timer);
      window.removeEventListener("jpd:presence-changed", onChanged);
    };
  }, [load]);

  // Only beats while something is actually claimed, so an idle tab is silent.
  React.useEffect(() => {
    if (entries.length === 0) return;
    const timer = setInterval(() => {
      void api.post("/api/presence/mine", { action: "HEARTBEAT" }).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [entries.length]);

  async function stop(entry: MyPresence) {
    setStopping(entry.eventId);
    try {
      const data = await api.post<{ presence: MyPresence[] }>("/api/presence/mine", {
        action: "STOP",
        eventId: entry.eventId,
        context: entry.context,
      });
      setEntries(data.presence);
      // Let the tables drop the row highlight without waiting for their stream.
      window.dispatchEvent(new CustomEvent("jpd:presence-changed"));
    } catch {
      void load();
    } finally {
      setStopping(null);
    }
  }

  if (entries.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1.5 lg:px-6"
      style={{ background: "var(--live-soft)", borderColor: "var(--live)" }}
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--live)" }}>
        <span aria-hidden className="jpd-live-dot h-2 w-2 rounded-full"
              style={{ background: "var(--live)" }} />
        In progress
      </span>

      {entries.map((entry) => (
        <span key={`${entry.eventId}:${entry.context}`}
              className="flex items-center gap-1.5 text-[12px]"
              style={{ color: "var(--ink)" }}>
          <span className="truncate max-w-[22rem]">{entry.label}</span>
          <span className="tabular-nums" style={{ color: "var(--ink-subtle)" }}>
            {entry.minutesActive > 0 ? `${entry.minutesActive}m` : "just now"}
          </span>
          <button
            type="button"
            onClick={() => void stop(entry)}
            disabled={stopping === entry.eventId}
            className="rounded border px-1.5 py-px text-[11px] font-medium transition disabled:opacity-60"
            style={{ borderColor: "var(--live)", color: "var(--live)" }}
            title="Stop working on this"
          >
            Stop
          </button>
        </span>
      ))}
    </div>
  );
}
