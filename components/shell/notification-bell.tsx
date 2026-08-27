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
 * How often the bell re-reads.
 *
 * Slower than presence: a flag is not a live feed, and somebody hearing about
 * one forty seconds late has lost nothing. Fast enough that it arrives while
 * they are still at their desk.
 */
const REFRESH_MS = 45_000;

const HEADLINE: Record<NotificationKind, string> = {
  FLAG_RAISED: "flagged an event",
  FLAG_FIXED: "says a flag is dealt with",
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

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
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

  async function markRead(ids: string[] | "ALL") {
    try {
      const data = await api.post<{
        notifications: NotificationView[];
        unreadCount: number;
      }>("/api/notifications", ids === "ALL" ? { action: "READ_ALL" } : { action: "READ", ids });
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      void load();
    }
  }

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
            {unread > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => void markRead("ALL")}>
                Mark all read
              </Button>
            ) : null}
          </div>

          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => openEvent(item)}
              className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition hover:brightness-95"
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
