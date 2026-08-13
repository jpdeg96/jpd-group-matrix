"use client";

import * as React from "react";
import { Button, Dialog } from "@/components/ui/primitives";
import {
  newestAnnouncementId,
  selectAnnouncements,
  type Announcement,
  type AnnouncementKind,
} from "@/lib/domain/announcements";

/**
 * "What changed", shown once per person per release.
 *
 * The list is compiled into the bundle rather than fetched, so there is no
 * endpoint to call and nothing to keep in step: the announcement and the change
 * it describes arrive in the same deploy or neither does.
 *
 * Acknowledgement is per browser rather than per account. A shared machine or a
 * second laptop means seeing a note twice, which is a much smaller cost than a
 * database table and a migration for something nobody would miss.
 */

function storageKey(userId: string): string {
  return `jpd.announcements.seen.${userId}`;
}

const KIND_LABEL: Record<AnnouncementKind, string> = {
  added: "New",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
};

const KIND_COLOR: Record<AnnouncementKind, string> = {
  added: "var(--live)",
  changed: "var(--accent)",
  fixed: "var(--success)",
  removed: "var(--ink-subtle)",
};

export function AnnouncementsDialog({ userId }: { userId: string }) {
  const [shown, setShown] = React.useState<Announcement[]>([]);
  const [hiddenCount, setHiddenCount] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let lastSeen: string | null = null;
    try {
      lastSeen = window.localStorage.getItem(storageKey(userId));
    } catch {
      // Private browsing. The note simply shows every load, which is visible
      // and mildly annoying rather than silently broken.
    }

    const selection = selectAnnouncements(lastSeen);
    if (selection.shown.length === 0) return;

    setShown(selection.shown);
    setHiddenCount(selection.hiddenCount);
    setOpen(true);
  }, [userId]);

  const dismiss = React.useCallback(() => {
    setOpen(false);
    try {
      const newest = newestAnnouncementId();
      // Records the newest entry, not the newest *shown* one, so the capped-off
      // remainder is not re-offered on the next load.
      if (newest) window.localStorage.setItem(storageKey(userId), newest);
    } catch {
      // As above.
    }
  }, [userId]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="What's new"
      description={
        hiddenCount > 0
          ? `The most recent changes, plus ${hiddenCount} earlier one${hiddenCount === 1 ? "" : "s"}.`
          : "Changes since you were last here."
      }
      footer={
        <Button size="sm" variant="primary" onClick={dismiss}>
          Got it
        </Button>
      }
    >
      <ul className="space-y-3.5">
        {shown.map((entry) => (
          <li key={entry.id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: "var(--canvas)",
                  color: KIND_COLOR[entry.kind],
                }}
              >
                {KIND_LABEL[entry.kind]}
              </span>
              <span className="text-[13px] font-semibold">{entry.title}</span>
              <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                {entry.date}
              </span>
            </div>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
              {entry.body}
            </p>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
