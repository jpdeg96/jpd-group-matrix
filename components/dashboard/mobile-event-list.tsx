"use client";

import * as React from "react";
import { UserChip } from "@/components/ui/primitives";
import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { daysUntilEvent } from "@/lib/domain/review-schedule";
import type { DashboardEventView } from "@/lib/services/events";

/**
 * The checks a dashboard event carries, in the order the table shows them.
 *
 * Abbreviated because three full words do not fit beside a date on a 390px
 * screen, and the tick is the information — which check it was matters only
 * once something is missing, which is what the title attribute is for.
 */
const CHECKS = [
  { key: "sg", label: "SG", title: "SeatGeek checked" },
  { key: "td", label: "TD", title: "Ticket data checked" },
  { key: "au", label: "AU", title: "Audited" },
] as const;

/**
 * One event, as a card.
 *
 * Read-only on purpose. This is the phone view of work somebody has been
 * given, not a second place to do it: a tick here would be a second write path
 * into the same rows, with its own optimistic update to get wrong, for a
 * gesture that is genuinely easier at a desk.
 */
function EventCard({
  event,
  today,
  workedBy,
}: {
  event: DashboardEventView;
  today: PlainDate;
  /** Whoever currently has this open, if anyone. */
  workedBy: ReadonlyArray<{ userName: string; userColor: string }>;
}) {
  const days = daysUntilEvent(event.eventDate, today);
  const handedOff = event.status !== "DASHBOARD" && event.completedAt !== null;

  const ticks: Record<string, boolean> = {
    sg: event.seatGeekCheckedAt !== null,
    td: event.ticketDataChecked,
    au: event.auditedAt !== null,
  };

  /*
   * How close the event is, as one phrase.
   *
   * The table has a whole column for this and room for a tooltip; here it has
   * to survive next to the date in about nine characters.
   */
  const when =
    days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days}d`;

  return (
    <li
      className="rounded-lg border p-3"
      style={{
        borderColor: event.flaggedAt && !event.flagFixedAt ? "var(--danger)" : "var(--line)",
        background: "var(--surface)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {event.eventTypeEmoji ? (
              <span aria-hidden className="text-[13px]">
                {event.eventTypeEmoji}
              </span>
            ) : null}
            <span
              className="truncate text-[11px] font-medium"
              style={{ color: "var(--ink-subtle)" }}
            >
              {event.eventTypeName}
            </span>
          </div>

          <p className="mt-0.5 text-[14px] font-semibold leading-snug">
            {event.awayTeam && event.homeTeam
              ? `${event.awayTeam} at ${event.homeTeam}`
              : (event.awayTeam ?? event.homeTeam ?? event.eventTypeName)}
          </p>

          {event.venue ? (
            <p className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              {event.venue}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[11.5px] font-medium tabular-nums">
            {formatPlainDate(event.eventDate)}
          </div>
          <div
            className="text-[10.5px] tabular-nums"
            style={{ color: days <= 1 ? "var(--warn)" : "var(--ink-subtle)" }}
          >
            {when}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {handedOff ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--success-soft)", color: "var(--success)" }}
          >
            Sent to C1
          </span>
        ) : event.completedAt ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            Complete · awaiting C1
          </span>
        ) : (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
          >
            Open
          </span>
        )}

        {event.flaggedAt && !event.flagFixedAt ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
            title={event.flagReason ?? undefined}
          >
            Flagged
          </span>
        ) : null}

        {event.flaggedAt && event.flagFixedAt ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
            style={{ background: "var(--success-soft)", color: "var(--success)" }}
          >
            Flag resolved
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-1">
          {CHECKS.map((check) => (
            <span
              key={check.key}
              title={ticks[check.key] ? check.title : `${check.title} — not yet`}
              className="rounded px-1 py-0.5 text-[10px] font-bold"
              style={
                ticks[check.key]
                  ? { background: "var(--success-soft)", color: "var(--success)" }
                  : { background: "var(--line)", color: "var(--ink-subtle)" }
              }
            >
              {check.label}
            </span>
          ))}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {event.assigneeName ? (
          <UserChip
            name={event.assigneeName}
            color={event.assigneeColor ?? "#64748b"}
            className="text-[11.5px]"
          />
        ) : (
          <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
            Unassigned
          </span>
        )}

        {event.noteCount > 0 ? (
          <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
            {event.noteCount} {event.noteCount === 1 ? "note" : "notes"}
          </span>
        ) : null}

        {workedBy.length > 0 ? (
          <span className="ml-auto flex items-center gap-1">
            <span
              aria-hidden
              className="jpd-live-dot h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--live)" }}
            />
            <span className="text-[10.5px] font-medium" style={{ color: "var(--live)" }}>
              {workedBy.length === 1 ? workedBy[0]?.userName : `${workedBy.length} working`}
            </span>
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The Dashboard at phone width.
 *
 * Shown instead of the table below `md`, from the same already-filtered rows
 * the table would render — so the chips, the search box and the Mine toggle
 * above it govern both, and there is only one set of live connections behind
 * them either way.
 */
export function MobileEventList({
  events,
  today,
  byEvent,
}: {
  events: readonly DashboardEventView[];
  today: PlainDate;
  /** Live presence, exactly the map the table rows read. */
  byEvent: ReadonlyMap<string, ReadonlyArray<{ userName: string; userColor: string }>>;
}) {
  return (
    <ul className="space-y-2 px-3 pb-3">
      {events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          today={today}
          workedBy={byEvent.get(event.id) ?? []}
        />
      ))}
    </ul>
  );
}
