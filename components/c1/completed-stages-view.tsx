"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LegacyBadge,
  Muted,
  PageHeader,
  StatPill,
  Td,
  Th,
} from "@/components/ui/primitives";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { formatPlainDateWithWeekday, type PlainDate } from "@/lib/date/plain-date";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import { reviewStageLabel } from "@/lib/domain/constants";
import type { CompletedStageView } from "@/lib/services/stages";

/**
 * Review checkpoints somebody has ticked off.
 *
 * A separate screen from C1 rather than a mode of it, because it answers the
 * opposite question. C1 lists what is *outstanding* — one row per event, on its
 * current pending stage — and completing review work is exactly what removes an
 * event from that list. Showing finished work there would mean a table where
 * half the rows cannot be acted on and the checkboxes mean nothing.
 *
 * So this is deliberately read-only. It is a record of what was done, reached
 * from a Metrics bar, and there is nothing here to tick.
 */
export function CompletedStagesView({
  rows,
  personName,
  from,
  to,
}: {
  rows: CompletedStageView[];
  /** Whose work this is, when it was filtered to one person. */
  personName: string | null;
  from: PlainDate | null;
  to: PlainDate | null;
}) {
  const router = useRouter();

  const events = new Set(rows.map((row) => row.eventId)).size;

  function exportCsv() {
    const csv = toCsv(
      ["Completed", "Checkpoint", "Review due", "Event date", "Type", "Away", "Home", "Venue", "By", "Event status"],
      rows.map((row) => [
        row.doneAt,
        reviewStageLabel(row.offsetDays),
        row.reviewDue,
        row.eventDate,
        row.eventTypeName,
        row.awayTeam,
        row.homeTeam,
        row.venue,
        row.doneByName ?? "",
        row.eventStatus,
      ]),
    );
    downloadCsv(`review-work-${to ?? "all"}.csv`, csv);
  }

  const window =
    from && to
      ? `${formatPlainDateWithWeekday(from)} – ${formatPlainDateWithWeekday(to)}`
      : to
        ? `up to ${formatPlainDateWithWeekday(to)}`
        : "all time";

  return (
    <Card>
      <PageHeader
        title="Review work done"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="checkpoints ticked" value={rows.length} />
            <StatPill label="events" value={events} />
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              {window}
            </span>
          </div>
        }
        actions={
          <>
            {rows.length > 0 ? (
              <Button size="sm" onClick={exportCsv}>
                Export CSV
              </Button>
            ) : null}
            <Button size="sm" onClick={() => router.push("/c1")}>
              Back to C1
            </Button>
          </>
        }
      />

      <div
        className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-[12px]"
        style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
      >
        <span style={{ color: "var(--ink)" }}>
          {personName ? (
            <>
              Checkpoints <strong>{personName}</strong> ticked off, {window}.
            </>
          ) : (
            <>Every checkpoint ticked off, {window}.</>
          )}{" "}
          Events that have since left C1 are included — finishing their reviews is
          what took them out of it.
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No review work in this period"
          description={
            personName
              ? `${personName} did not tick off any C1 checkpoints in this window.`
              : "Nobody ticked off a C1 checkpoint in this window."
          }
          action={<Button onClick={() => router.push("/c1")}>Back to C1</Button>}
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead style={{ background: "var(--canvas)" }}>
              <tr>
                <Th className="w-[11rem]">Completed</Th>
                <Th className="w-[5rem]">Checkpoint</Th>
                <Th className="w-[9.5rem]">Review due</Th>
                <Th className="w-[9.5rem]">Event date</Th>
                <Th className="w-[6.5rem]">Type</Th>
                <Th className="w-[11.5rem]">Away Team / Artist</Th>
                <Th className="w-[11.5rem]">Home Team</Th>
                <Th className="w-[10rem]">Venue</Th>
                <Th className="w-[7rem]">Event</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stageId} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                  <Td className="text-[11.5px]">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      {row.doneByColor ? (
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: row.doneByColor }}
                        />
                      ) : null}
                      <span title={row.doneByName ?? undefined}>
                        {formatBusinessTimestamp(row.doneAt)}
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="inline-flex rounded border px-1.5 py-px font-mono text-[11px] font-semibold"
                      style={{ borderColor: "var(--line-strong)", background: "var(--canvas)" }}
                    >
                      {reviewStageLabel(row.offsetDays)}
                    </span>
                  </Td>
                  <Td className="text-[11.5px]">
                    <span style={{ color: "var(--ink-muted)" }}>
                      {formatPlainDateWithWeekday(row.reviewDue)}
                    </span>
                  </Td>
                  <Td className="text-[12px]">
                    <span className="flex flex-col items-start gap-1">
                      {formatPlainDateWithWeekday(row.eventDate)}
                      <LegacyBadge source={row.legacySource} />
                    </span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      {row.eventTypeEmoji ? (
                        <span aria-hidden className="text-[14px] leading-none">
                          {row.eventTypeEmoji}
                        </span>
                      ) : null}
                      {row.eventTypeName}
                    </span>
                  </Td>
                  <Td>{row.awayTeam ?? <Muted>—</Muted>}</Td>
                  <Td>{row.homeTeam ?? <Muted>—</Muted>}</Td>
                  <Td className="text-[12px]">{row.venue ?? <Muted>—</Muted>}</Td>
                  <Td>
                    {row.eventStatus === "C1" ? (
                      <Badge tone="accent">still in C1</Badge>
                    ) : row.eventStatus === "CANCELLED" ? (
                      <Badge tone="danger">cancelled</Badge>
                    ) : (
                      <Badge tone="success">finished</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
