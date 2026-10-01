"use client";

import * as React from "react";
import {
  PAY_TYPE_LABELS,
  formatHours,
  formatMoney,
  formatRate,
  type ApprovalStatus,
  type PayType,
} from "@/lib/domain/payroll-format";

interface Row {
  id: string;
  contractorName: string;
  invoicePrefix: string;
  payType: PayType;
  clockifySeconds: number;
  weeklyAmount: string | null;
  hourlyRate: string | null;
  invoiceAmount: string;
  managerStatus: ApprovalStatus;
  approvedByName: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
}

const STATUS_TONE: Record<ApprovalStatus, { bg: string; fg: string; label: string }> = {
  PENDING: { bg: "var(--line)", fg: "var(--ink-muted)", label: "Pending" },
  APPROVED: { bg: "var(--success-soft)", fg: "var(--success)", label: "Approved" },
  REJECTED: { bg: "var(--danger-soft)", fg: "var(--danger)", label: "Rejected" },
  NEEDS_REVIEW: { bg: "var(--warn-soft)", fg: "var(--warn)", label: "Needs review" },
};

/**
 * The week's approvals at phone width.
 *
 * Read-only, matching the rest of the phone layer. Approving is a decision
 * about money made against hours you are meant to check first, and the three
 * action buttons sit behind a confirm on a screen with room for the figures
 * beside them — which a 390px card does not have.
 *
 * The amount leads because it is what the row is for; the hours it was
 * calculated from sit directly under it, because an amount you cannot check
 * is not something anybody should be signing off from a phone either.
 */
export function MobileApprovalsList({ rows }: { rows: readonly Row[] }) {
  return (
    <ul className="space-y-2 px-3 pb-3">
      {rows.map((row) => {
        const tone = STATUS_TONE[row.managerStatus];

        return (
          <li
            key={row.id}
            className="rounded-lg border p-3"
            style={{ borderColor: "var(--line)", background: "var(--surface)" }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold">{row.contractorName}</p>
                {/* The rate as well as the type, carrying its unit — the same
                    `$x/hr` and `$x/wk` the table shows, because a bare number
                    beside an amount is the one thing nobody should have to
                    guess at on a payroll screen. */}
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                  {PAY_TYPE_LABELS[row.payType]}
                  {row.payType === "HOURLY"
                    ? ` · $${formatRate(row.hourlyRate ?? "0")}/hr`
                    : ` · $${formatMoney(row.weeklyAmount ?? "0")}/wk`}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[14px] font-semibold tabular-nums">
                  ${formatMoney(row.invoiceAmount)}
                </div>
                <div
                  className="text-[11px] tabular-nums"
                  style={{ color: "var(--ink-subtle)" }}
                >
                  {formatHours(row.clockifySeconds)} h
                </div>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                style={{ background: tone.bg, color: tone.fg }}
              >
                {tone.label}
              </span>

              {row.invoiceNumber ? (
                <span
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {row.invoiceNumber}
                </span>
              ) : null}

              {row.approvedByName ? (
                <span
                  className="ml-auto text-[10.5px]"
                  style={{ color: "var(--ink-subtle)" }}
                >
                  by {row.approvedByName}
                </span>
              ) : null}
            </div>

            {row.reviewNote ? (
              <p
                className="mt-2 whitespace-pre-wrap text-[11.5px]"
                style={{ color: "var(--ink-muted)" }}
              >
                {row.reviewNote}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
