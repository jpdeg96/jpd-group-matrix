"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";

export interface PresenceEntry {
  eventId: string;
  userId: string;
  userName: string;
  userColor: string;
  startedAt: string;
  minutesActive: number;
}

export type PresenceContext = "DASHBOARD" | "C1";

/** Polling cadence when SSE is unavailable. */
const POLL_MS = 5_000;

/**
 * Live "who is working on what".
 *
 * Transport is SSE with a polling fallback. EventSource reconnects on its own,
 * so a dropped connection heals without any retry logic here; if the browser or
 * a proxy blocks event streams entirely, polling keeps the feature working
 * rather than silently dying.
 *
 * A heartbeat refreshes this user's own claims. The server expires anything
 * that stops beating, which is what stops a closed laptop leaving an event
 * flagged forever.
 */
export function usePresence(context: PresenceContext, currentUserId: string) {
  const [entries, setEntries] = React.useState<PresenceEntry[]>([]);
  const [pendingEventId, setPendingEventId] = React.useState<string | null>(null);

  /**
   * Notifies the shell that this user's own claims changed, so the persistent
   * banner updates on the click rather than on its next poll.
   */
  const announce = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent("jpd:presence-changed"));
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Receiving updates                                                       */
  /* ---------------------------------------------------------------------- */

  React.useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      const poll = async () => {
        try {
          const data = await api.get<{ presence: PresenceEntry[] }>(
            `/api/presence?context=${context}`,
          );
          if (!cancelled) setEntries(data.presence);
        } catch {
          // Transient — the next tick tries again.
        }
      };
      void poll();
      pollTimer = setInterval(poll, POLL_MS);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
    } else {
      source = new EventSource(`/api/presence/stream?context=${context}`);

      source.addEventListener("presence", (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            presence: PresenceEntry[];
          };
          setEntries(payload.presence);
        } catch {
          // Ignore a malformed frame rather than tearing down the stream.
        }
      });

      // The server closes the stream every ~50s by design and EventSource
      // reconnects itself, so an error here is usually that expected cycle.
      // Only fall back to polling if the connection is genuinely dead.
      source.onerror = () => {
        if (source && source.readyState === EventSource.CLOSED) {
          startPolling();
        }
      };
    }

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [context]);

  /* ---------------------------------------------------------------------- */
  /* Publishing our own presence                                             */
  /* ---------------------------------------------------------------------- */

  /*
   * No heartbeat and no release here, deliberately.
   *
   * Both used to live in this hook, which unmounts the moment you navigate from
   * the Dashboard to any other screen — and its cleanup sent a CLEAR, so simply
   * walking to C1 silently dropped every claim you held. That is the bug behind
   * "the in-progress state does not stick".
   *
   * The heartbeat now lives in the app shell (`WorkingBanner`), which outlives
   * navigation, and a claim is released only by an explicit stop, by completing
   * the event, or by the server's heartbeat timeout. Closing the tab is covered
   * by that timeout rather than by an unload handler: a tab crash and a closed
   * laptop must behave the same way, and only expiry does that.
   */

  const setWorking = React.useCallback(
    async (eventId: string, working: boolean) => {
      setPendingEventId(eventId);

      // Optimistic, so the row lights up on click rather than after a round
      // trip. The server's next broadcast is authoritative.
      setEntries((current) =>
        working
          ? [
              ...current.filter(
                (entry) =>
                  !(entry.eventId === eventId && entry.userId === currentUserId),
              ),
              {
                eventId,
                userId: currentUserId,
                userName: "You",
                userColor: "var(--live)",
                startedAt: new Date().toISOString(),
                minutesActive: 0,
              },
            ]
          : current.filter(
              (entry) =>
                !(entry.eventId === eventId && entry.userId === currentUserId),
            ),
      );

      try {
        const result = await api.post<{ presence: PresenceEntry[] }>(
          "/api/presence",
          { eventId, context, action: working ? "START" : "STOP" },
        );

        setEntries(result.presence);
        announce();
      } catch {
        // Roll back the optimistic change.
        setEntries((current) =>
          current.filter(
            (entry) => !(entry.eventId === eventId && entry.userId === currentUserId),
          ),
        );
      } finally {
        setPendingEventId(null);
      }
    },
    [context, currentUserId, announce],
  );

  const byEvent = React.useMemo(() => {
    const map = new Map<string, PresenceEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.eventId);
      if (list) list.push(entry);
      else map.set(entry.eventId, [entry]);
    }
    return map;
  }, [entries]);

  const isWorking = React.useCallback(
    (eventId: string) =>
      entries.some(
        (entry) => entry.eventId === eventId && entry.userId === currentUserId,
      ),
    [entries, currentUserId],
  );

  return { byEvent, isWorking, setWorking, pendingEventId, activeCount: entries.length };
}
