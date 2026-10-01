"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  UserChip,
} from "@/components/ui/primitives";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  NOTIFICATION_HEADLINE,
  useNotifications,
  type NotificationKind,
  type NotificationView,
} from "@/components/shell/use-notifications";

/**
 * A tint per kind, so the reason an entry is here reads before the words do.
 *
 * A raised flag is somebody asking for work; a resolved one is somebody
 * reporting it done. Scrolling a phone screen of eight of these, the colour is
 * what separates "three people need me" from "three things finished".
 */
const TONE: Record<NotificationKind, { bg: string; fg: string; label: string }> = {
  FLAG_RAISED: { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Flag" },
  FLAG_FIXED: { bg: "var(--success-soft)", fg: "var(--success)", label: "Resolved" },
  FLAG_CLEARED: { bg: "var(--accent-soft)", fg: "var(--accent)", label: "Cleared" },
  MENTIONED: { bg: "var(--warn-soft)", fg: "var(--warn)", label: "Mention" },
};

/**
 * Flags and mentions as a screen of their own.
 *
 * The same list the header bell shows, from the same hook and the same live
 * stream. It exists because the bell is a dropdown hanging off a header icon,
 * which is a fine shape for a glance on a wide screen and the wrong shape for
 * the thing you opened your phone to check.
 */
export function AlertsView() {
  const router = useRouter();
  const { items, unread, markRead, clear } = useNotifications();

  function openEvent(item: NotificationView) {
    if (!item.readAt) void markRead([item.id]);
    router.push(`/dashboard?focus=${item.eventId}`);
  }

  return (
    <div className="space-y-3">
      <Card>
        <PageHeader
          title="Alerts"
          subtitle={
            unread === 0
              ? "Flags raised on your events, and notes that mention you."
              : unread === 1
                ? "1 unread"
                : `${unread} unread`
          }
          actions={
            <>
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
            </>
          }
        />
      </Card>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing needs your attention"
          description="Flags raised on events you hold, and notes that mention you by name, arrive here as they happen."
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const tone = TONE[item.kind];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openEvent(item)}
                // A whole-card target rather than a link in the text: on a
                // phone this is the only thing you can do with the entry, and
                // a 44px row is the difference between tapping it and
                // tapping the one underneath.
                className="jpd-hover-ring flex w-full flex-col items-start gap-1.5 rounded-lg border p-3 text-left"
                style={{
                  borderColor: item.readAt ? "var(--line)" : "transparent",
                  background: item.readAt ? "var(--surface)" : "var(--accent-soft)",
                }}
              >
                <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    {tone.label}
                  </span>
                  {item.actorName ? (
                    <UserChip
                      name={item.actorName}
                      color={item.actorColor ?? "#64748b"}
                      className="text-[12px] font-medium"
                    />
                  ) : (
                    <span className="text-[12px] font-medium">Somebody</span>
                  )}
                  <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    {NOTIFICATION_HEADLINE[item.kind]}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-[10.5px] whitespace-nowrap"
                    style={{ color: "var(--ink-subtle)" }}
                  >
                    {formatBusinessTimestamp(item.createdAt)}
                  </span>
                </span>

                <span className="block w-full text-[13px] font-medium">
                  {item.eventLabel}
                </span>

                {item.detail ? (
                  <span
                    className="block w-full whitespace-pre-wrap text-[12px]"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {item.detail}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
