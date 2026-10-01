"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, UserChip } from "@/components/ui/primitives";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  NOTIFICATION_HEADLINE,
  useNotifications,
  type NotificationView,
} from "./use-notifications";

/**
 * What needs this person's attention.
 *
 * The dropdown is the desktop shape. On a phone the same list is a whole
 * screen at /alerts, reached from the tab bar — a 26rem panel hanging off a
 * header icon does not fit a 390px viewport, and the list is the main event
 * there rather than a glance.
 *
 * Clicking an entry marks it read and opens the event on the screen it belongs
 * to, because a notification you cannot act on from is just an interruption.
 */
export function NotificationBell() {
  const router = useRouter();
  const { items, unread, markRead, clear } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
                  onClick={() => void clear()}
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
                    {NOTIFICATION_HEADLINE[item.kind]}
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

          <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--line)" }}>
            <Link
              href="/alerts"
              onClick={() => setOpen(false)}
              className="text-[11px] underline"
              style={{ color: "var(--ink-muted)" }}
            >
              Open as a full page
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
