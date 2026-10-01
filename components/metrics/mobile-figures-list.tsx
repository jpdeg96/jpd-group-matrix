"use client";

import * as React from "react";
import { Badge } from "@/components/ui/primitives";

interface UserRow {
  userId: string;
  displayName: string;
  color: string;
  active: boolean;
  eventsCompleted: number;
  stagesDone: number;
  seatGeekChecks: number;
  audits: number;
  notes: number;
  total: number;
}

/**
 * The columns, in the order the table shows them.
 *
 * Laid out as a small grid under each name rather than as a row, because
 * eight columns at 390px leaves about 40px each — enough for the numbers and
 * not for the headings that say what they are.
 */
const FIGURES = [
  { key: "eventsCompleted", label: "Completed" },
  { key: "stagesDone", label: "Stages" },
  { key: "seatGeekChecks", label: "SeatGeek" },
  { key: "audits", label: "Audits" },
  { key: "notes", label: "Notes" },
] as const;

/**
 * Per-person figures at phone width.
 *
 * This list is the accessibility fallback for the charts above as well as the
 * phone layout — which is why it is a real list of labelled numbers rather
 * than a squeezed table: it has to be readable when the colour encoding is
 * not available, on any width.
 */
export function MobileFiguresList({ users }: { users: readonly UserRow[] }) {
  return (
    <ul className="space-y-2 px-3 pb-3">
      {users.map((user) => (
        <li
          key={user.userId}
          className="rounded-lg border p-3"
          style={{ borderColor: "var(--line)", background: "var(--surface)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: user.color }}
              />
              <span className="truncate text-[13px] font-semibold">{user.displayName}</span>
              {!user.active ? <Badge>inactive</Badge> : null}
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[15px] font-bold tabular-nums">{user.total}</span>
              <span className="block text-[10px]" style={{ color: "var(--ink-subtle)" }}>
                total
              </span>
            </span>
          </div>

          <dl className="mt-2 grid grid-cols-5 gap-1">
            {FIGURES.map((figure) => (
              <div key={figure.key} className="text-center">
                <dt className="text-[9.5px] leading-tight" style={{ color: "var(--ink-subtle)" }}>
                  {figure.label}
                </dt>
                <dd className="text-[13px] font-medium tabular-nums">{user[figure.key]}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
