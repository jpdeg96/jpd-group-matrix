"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, PageHeader, StatPill } from "@/components/ui/primitives";
import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import { formatHours } from "@/lib/domain/payroll-format";

interface Entry {
  id: string;
  contractorName: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  description: string | null;
  clockifyEntryId: string;
  importedAt: string;
}

export function ImportedTimeView({
  period,
  periods,
  entries,
}: {
  period: { periodStart: PlainDate; periodEnd: PlainDate };
  periods: { id: string; periodStart: PlainDate; periodEnd: PlainDate }[];
  entries: Entry[];
}) {
  const router = useRouter();
  const [contractor, setContractor] = React.useState("");

  const names = React.useMemo(
    () => [...new Set(entries.map((entry) => entry.contractorName))].sort(),
    [entries],
  );

  const visible = contractor
    ? entries.filter((entry) => entry.contractorName === contractor)
    : entries;

  const totalSeconds = visible.reduce((total, entry) => total + entry.durationSeconds, 0);

  return (
    <Card>
      <PageHeader
        title="Imported time"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="entries" value={visible.length} />
            <StatPill label="hours" value={formatHours(totalSeconds)} />
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              {formatPlainDate(period.periodStart)} – {formatPlainDate(period.periodEnd)}
            </span>
          </div>
        }
        actions={
          <>
            <select
              value={contractor}
              onChange={(event) => setContractor(event.target.value)}
              aria-label="Contractor"
              className="rounded-md border px-2 py-1 text-[12px]"
              style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
            >
              <option value="">All contractors</option>
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={period.periodStart}
              onChange={(event) => router.push(`/payroll/time?period=${event.target.value}`)}
              aria-label="Pay period"
              className="rounded-md border px-2 py-1 text-[12px]"
              style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
            >
              {periods.map((option) => (
                <option key={option.id} value={option.periodStart}>
                  {formatPlainDate(option.periodStart)} – {formatPlainDate(option.periodEnd)}
                </option>
              ))}
            </select>
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState
          title="Nothing imported for this week"
          description="Time appears here once an administrator imports it from the Payroll dashboard. Running timers are never imported — they have no end, so there is no duration to pay."
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead style={{ background: "var(--canvas)" }}>
              <tr>
                {["Contractor", "Start", "End", "Hours", "Description", "Clockify entry", "Imported"].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--ink-subtle)" }}
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-3 py-2 text-[12.5px]">{entry.contractorName}</td>
                  <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                    {formatBusinessTimestamp(entry.startTime)}
                  </td>
                  <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                    {formatBusinessTimestamp(entry.endTime)}
                  </td>
                  <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
                    {formatHours(entry.durationSeconds)}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {entry.description ?? (
                      <span style={{ color: "var(--ink-subtle)" }}>—</span>
                    )}
                  </td>
                  {/* The id is what makes re-import idempotent, so it is shown:
                      it is the answer to "did this shift get counted twice?" */}
                  <td className="px-3 py-2 font-mono text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                    {entry.clockifyEntryId}
                  </td>
                  <td className="px-3 py-2 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                    {formatBusinessTimestamp(entry.importedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
