"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, UserChip } from "@/components/ui/primitives";
import { api } from "@/lib/ui/api-client";
import { formatBusinessTimestamp } from "@/lib/date/business-time";

type NotificationKind = "FLAG_RAISED" | "FLAG_FIXED" | "FLAG_CLEARED" | "MENTIONED";

interface NotificationView {
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

/**
 * Polling cadence when the live stream is unavailable.
 *
 * Only a fallback. The stream is the normal path; this covers a browser or
 * proxy that blocks event streams outright, where silently never updating
 * would be far worse than a slow update.
 */
const POLL_MS = 20_000;

const HEADLINE: Record<NotificationKind, string> = {
  FLAG_RAISED: "flagged an event",
  FLAG_FIXED: "marked a flag resolved",
  FLAG_CLEARED: "cleared a flag you were on",
  MENTIONED: "mentioned you in a note",
};

/**
 * What needs this person's attention.
 *
 * Only ever their own: the endpoint takes no recipient, so there is no request
 * shape that asks for somebody else's. Clicking an entry marks it read and
 * opens the event on the screen it belongs to, because a notification you
 * cannot act on from is just an interruption.
 */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = React.useState<NotificationView[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
      // the bell is empty.
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

  async function send(body: Record<string, unknown>) {
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
  }

  const markRead = (ids: string[] | "ALL") =>
    send(ids === "ALL" ? { action: "READ_ALL" } : { action: "READ", ids });

  function openEvent(item: NotificationView) {
    setOpen(false);
    if (!item.readAt) void markRead([item.id]);
    router.push(`/dashboard?focus=${item.eventId}`);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={
          unread > 0 ? `${unread} unread notifications` : "Notifications"
        }
        title={
          unread > 0
            ? unread === 1
              ? "1 thing needs your attention"
              : `${unread} things need your attention`
            : "Nothing needs your attention"
        }
        className="relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition"
        style={{
          borderColor: unread > 0 ? "transparent" : "var(--line-strong)",
          background: unread > 0 ? "var(--danger-soft)" : "transparent",
          color: unread > 0 ? "var(--danger)" : "var(--ink-muted)",
        }}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 ? <span className="tabular-nums">{unread}</span> : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 max-h-[70vh] w-[26rem] overflow-y-auto rounded-md border p-1 shadow-xl scrollbar-thin"
          style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}
        >
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
              {items.length === 0
                ? "Nothing needs your attention."
                : "Click one to open the event."}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {unread > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => void markRead("ALL")}>
                  Mark all read
                </Button>
              ) : null}
              {items.length > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  title="Remove them all. Marking read only says you have seen them."
                  onClick={() => void send({ action: "CLEAR" })}
                >
                  Clear
                </Button>
              ) : null}
            </span>
          </div>

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => openEvent(item)}
              // An outline rather than a brightness shift: an unread entry is
              // already tinted, so brightening it says nothing, and these are
              // three lines of small text stacked tightly where a tint leaves
              // the boundary ambiguous.
              className="jpd-hover-ring flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left"
              style={{
                background: item.readAt ? "transparent" : "var(--accent-soft)",
              }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  {item.actorName ? (
                    <UserChip
                      name={item.actorName}
                      color={item.actorColor ?? "#64748b"}
                      className="text-[11.5px] font-medium"
                    />
                  ) : (
                    <span className="text-[11.5px] font-medium">Somebody</span>
                  )}
                  <span className="text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                    {HEADLINE[item.kind]}
                  </span>
                </span>
                <span
                  className="shrink-0 text-[10.5px] whitespace-nowrap"
                  style={{ color: "var(--ink-subtle)" }}
                >
                  {formatBusinessTimestamp(item.createdAt)}
                </span>
              </span>

              <span className="block w-full truncate text-[12px] font-medium">
                {item.eventLabel}
              </span>

              {item.detail ? (
                <span
                  className="line-clamp-2 whitespace-pre-wrap text-[11px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {item.detail}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
