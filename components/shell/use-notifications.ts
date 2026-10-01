"use client";

import * as React from "react";
import { api } from "@/lib/ui/api-client";

export type NotificationKind =
  | "FLAG_RAISED"
  | "FLAG_FIXED"
  | "FLAG_CLEARED"
  | "MENTIONED";

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  eventId: string;
  eventLabel: string;
  actorName: string | null;
  actorColor: string | null;
  detail: string | null;
  readAt: string | null;
  createdAt: string;
}

export const NOTIFICATION_HEADLINE: Record<NotificationKind, string> = {
  FLAG_RAISED: "flagged an event",
  FLAG_FIXED: "marked a flag resolved",
  FLAG_CLEARED: "cleared a flag you were on",
  MENTIONED: "mentioned you in a note",
};

/**
 * Polling cadence when the live stream is unavailable.
 *
 * Only a fallback. The stream is the normal path; this covers a browser or
 * proxy that blocks event streams outright, where silently never updating
 * would be far worse than a slow update.
 */
const POLL_MS = 20_000;

/**
 * What needs this person's attention, kept live.
 *
 * Extracted from the header bell because the phone layout needs the same list
 * as a whole screen: a dropdown anchored to a 40px icon is the wrong shape at
 * 390px wide, but it is the same data, the same stream and the same read and
 * clear actions. Two copies of the stream logic would have been two chances to
 * drift, and the one that drifted would be the one nobody is watching.
 *
 * Only ever the caller's own notifications: the endpoint takes no recipient,
 * so there is no request shape that asks for somebody else's.
 */
export function useNotifications() {
  const [items, setItems] = React.useState<NotificationView[]>([]);
  const [unread, setUnread] = React.useState(0);

  const load = React.useCallback(async () => {
    try {
      const data = await api.get<{
        notifications: NotificationView[];
        unreadCount: number;
      }>("/api/notifications");
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      // Ambient: a failed poll keeps the last known state rather than claiming
      // the list is empty.
    }
  }, []);

  /*
   * Live, not polled.
   *
   * A flag raised on somebody's event is a request for them to do something
   * now, and the whole point is lost if they find out on their next page load.
   * The server pushes when the list actually changes; a browser that cannot use
   * event streams falls back to polling rather than silently never updating.
   *
   * EventSource reconnects on its own, so a dropped connection heals without
   * any retry logic here — and the server re-sends on the first tick of each
   * connection, so nothing that happened across the gap is missed.
   */
  React.useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      void load();
      pollTimer = setInterval(() => void load(), POLL_MS);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
    } else {
      source = new EventSource("/api/notifications/stream");

      source.addEventListener("notifications", (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse((event as MessageEvent).data) as {
            notifications: NotificationView[];
            unreadCount: number;
          };
          setItems(payload.notifications);
          setUnread(payload.unreadCount);
        } catch {
          // Ignore a malformed frame rather than tearing down the stream.
        }
      });

      // The server closes every ~50s by design and the browser reconnects, so
      // an error here is usually that expected cycle. Only fall back to polling
      // if the connection is genuinely dead.
      source.onerror = () => {
        if (source && source.readyState === EventSource.CLOSED) startPolling();
      };
    }

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [load]);

  const send = React.useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const data = await api.post<{
          notifications: NotificationView[];
          unreadCount: number;
        }>("/api/notifications", body);
        setItems(data.notifications);
        setUnread(data.unreadCount);
      } catch {
        void load();
      }
    },
    [load],
  );

  const markRead = React.useCallback(
    (ids: string[] | "ALL") =>
      send(ids === "ALL" ? { action: "READ_ALL" } : { action: "READ", ids }),
    [send],
  );

  const clear = React.useCallback(() => send({ action: "CLEAR" }), [send]);

  return { items, unread, markRead, clear };
}
