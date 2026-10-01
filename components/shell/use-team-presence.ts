"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";
import type { PlainDate } from "@/lib/date/plain-date";

export interface TeamPresence {
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
 * How often the list re-reads.
 *
 * Matched to the client heartbeat, so somebody starting work shows up within
 * about half a minute. Faster would be a live feed nobody asked for; the tables
 * already have SSE for the rows actually in front of you.
 */
const REFRESH_MS = 30_000;

/** Above this, a claim is old enough to be worth a second look. */
export const LONG_RUNNING_MINUTES = 45;

export function formatElapsed(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours < 4 && rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Who is working on what, right now.
 *
 * Shared by the header chip and the full-page view, so the phone screen and
 * the desktop glance cannot disagree about who is working. The endpoint
 * enforces `presence.viewTeam` itself; callers that render this still have to
 * check it, or they would show an empty panel to somebody who simply is not
 * allowed to see it and leave them wondering why the team looks idle.
 */
export function useTeamPresence() {
  const [entries, setEntries] = React.useState<TeamPresence[]>([]);

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

    // The tables fire this on Start and Stop, so the list reacts to a click
    // in this tab rather than waiting out the poll.
    const onChanged = () => void load();
    window.addEventListener("jpd:presence-changed", onChanged);

    return () => {
      clearInterval(timer);
      window.removeEventListener("jpd:presence-changed", onChanged);
    };
  }, [load]);

  // One person on three events is one person working, not three.
  const peopleCount = React.useMemo(
    () => new Set(entries.map((entry) => entry.userId)).size,
    [entries],
  );

  return { entries, peopleCount };
}
