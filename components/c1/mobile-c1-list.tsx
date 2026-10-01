"use client";

import * as React from "react";
import { UserChip } from "@/components/ui/primitives";
import { comparePlainDates, formatPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { reviewStageLabel } from "@/lib/domain/constants";
import type { C1RowView } from "@/lib/services/stages";

/**
 * One review, as a card.
 *
 * Read-only, like the phone Dashboard. The thing a reviewer needs away from a
 * desk is which of their reviews are due and how close the event is; ticking
 * one off is a desk gesture with a server rule behind it about who holds the
 * stage, and a second write path into it buys nothing.
 */
function C1Card({ row, today }: { row: C1RowView; today: PlainDate }) {
  const dueDelta = comparePlainDates(row.reviewDue, today);
  const overdue = dueDelta < 0;
  const dueToday = dueDelta === 0;

  const progress =
    row.totalStages > 0 ? `${row.resolvedStages}/${row.totalStages}` : null;

  return (
    <li
      className="rounded-lg border p-3"
      style={{
        borderColor: row.flaggedAt && !row.flagFixedAt ? "var(--danger)" : "var(--line)",
        background: "var(--surface)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {row.eventTypeEmoji ? (
              <span aria-hidden className="text-[13px]">
                {row.eventTypeEmoji}
              </span>
            ) : null}
            <span
              className="truncate text-[11px] font-medium"
              style={{ color: "var(--ink-subtle)" }}
            >
              {row.eventTypeName}
            </span>
          </div>

          <p className="mt-0.5 text-[14px] font-semibold leading-snug">
            {row.awayTeam && row.homeTeam
              ? `${row.awayTeam} at ${row.homeTeam}`
              : (row.awayTeam ?? row.homeTeam ?? row.eventTypeName)}
          </p>

          {row.venue ? (
            <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              {row.venue}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[11.5px] font-medium tabular-nums">
            {formatPlainDate(row.eventDate)}
          </div>
          <div className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
            event date
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* The review deadline is what C1 is sorted and worked by, so it gets
            the loudest treatment on the card rather than sitting in a column
            halfway across a table. */}
        <span
          className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
          style={
            overdue
              ? { background: "var(--danger-soft)", color: "var(--danger)" }
              : dueToday
                ? { background: "var(--warn-soft)", color: "var(--warn)" }
                : { background: "var(--accent-soft)", color: "var(--accent)" }
          }
        >
          {reviewStageLabel(row.offsetDays)} due {formatPlainDate(row.reviewDue)}
          {overdue ? " · overdue" : dueToday ? " · today" : ""}
        </span>

        {row.flaggedAt && !row.flagFixedAt ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            title={row.flagReason ?? undefined}
          >
            Flagged
          </span>
        ) : null}

        {row.scheduleDrifted ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
            title="The event date moved after it was promoted, so this review date no longer matches the schedule."
          >
            Date drifted
          </span>
        ) : null}

        {progress ? (
          <span
            className="ml-auto text-[11px] tabular-nums"
            style={{ color: "var(--ink-subtle)" }}
          >
            {progress} reviews done
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {row.assigneeName ? (
          <UserChip
            name={row.assigneeName}
            color={row.assigneeColor ?? "#64748b"}
            className="text-[11.5px]"
          />
        ) : (
          <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
            Unassigned
          </span>
        )}

        {row.noteCount > 0 ? (
          <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            {row.noteCount} {row.noteCount === 1 ? "note" : "notes"}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * C1 at phone width.
 *
 * Shown instead of the table below `md`, from the same already-filtered and
 * paged rows, so the chips above govern both layouts and there is one set of
 * live connections behind them.
 */
export function MobileC1List({
  rows,
  today,
}: {
  rows: readonly C1RowView[];
  today: PlainDate;
}) {
  return (
    <ul className="space-y-2 px-3 pb-3">
      {rows.map((row) => (
        <C1Card key={row.stageId} row={row} today={today} />
      ))}
    </ul>
  );
}
