"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatPill,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  APPROVAL_STATUS_LABELS,
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

const STATUS_TONE: Record<ApprovalStatus, string> = {
  PENDING: "var(--ink-subtle)",
  APPROVED: "var(--success)",
  REJECTED: "var(--danger)",
  NEEDS_REVIEW: "var(--warn)",
};

/**
 * The manager's screen.
 *
 * Clockify Basic has no approval step, so this is where a week is actually
 * signed off. Every row shows the hours it was calculated from *and* the
 * amount, because approving a number you cannot check is not approving.
 */
export function ApprovalsView({
  isAdmin,
  period,
  periods,
  rows,
}: {
  isAdmin: boolean;
  period: { id: string; periodStart: PlainDate; periodEnd: PlainDate; depositDate: PlainDate };
  periods: { id: string; periodStart: PlainDate; periodEnd: PlainDate }[];
  rows: Row[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = React.useState(false);

  async function setStatus(row: Row, status: ApprovalStatus, note?: string) {
    if (pending.has(row.id)) return;
    setPending((current) => new Set(current).add(row.id));

    try {
      await api.patch(`/api/payroll/approvals/${row.id}`, {
        managerStatus: status,
        reviewNote: note ?? null,
      });
      router.refresh();
    } catch (error) {
      toast.error(
        `Could not update ${row.contractorName}.`,
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }

  const reviewable = rows.filter(
    (row) => row.managerStatus !== "APPROVED" && row.invoiceNumber === null,
  );

  async function approveAll() {
    setConfirmBulk(false);
    for (const row of reviewable) {
      await setStatus(row, "APPROVED");
    }
    toast.success(`Approved ${reviewable.length} row${reviewable.length === 1 ? "" : "s"}.`);
  }

  const totals = rows.reduce(
    (acc, row) => {
      const amount = Number(row.invoiceAmount);
      acc.all += amount;
      if (row.managerStatus === "APPROVED") acc.approved += amount;
      acc.seconds += row.clockifySeconds;
      return acc;
    },
    { all: 0, approved: 0, seconds: 0 },
  );

  return (
    <div className="space-y-4">
      <Card>
        <PageHeader
          title="Weekly approval"
          subtitle={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <StatPill label="rows" value={rows.length} />
              <StatPill label="hours" value={formatHours(totals.seconds)} />
              <StatPill label="approved" value={`$${formatMoney(totals.approved.toFixed(2))}`} tone="success" />
              <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
                Deposit {formatPlainDate(period.depositDate)}
              </span>
            </div>
          }
          actions={
            <>
              <select
                value={period.periodStart}
                onChange={(event) =>
                  router.push(`/payroll/approvals?period=${event.target.value}`)
                }
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

              {reviewable.length > 0 ? (
                <Button size="sm" onClick={() => setConfirmBulk(true)}>
                  Approve all ({reviewable.length})
                </Button>
              ) : null}
            </>
          }
        />

        {/* Bulk approval is the one action here that can commit real money in
            a single click, so it asks first and says exactly what it covers. */}
        {confirmBulk ? (
          <div
            className="flex flex-wrap items-center gap-3 border-b px-5 py-3"
            style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}
          >
            <span className="text-[12.5px]">
              Approve {reviewable.length} row{reviewable.length === 1 ? "" : "s"} totalling{" "}
              <strong>
                $
                {formatMoney(
                  reviewable
                    .reduce((total, row) => total + Number(row.invoiceAmount), 0)
                    .toFixed(2),
                )}
              </strong>
              ?
            </span>
            <Button size="sm" variant="primary" onClick={approveAll}>
              Yes, approve them
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmBulk(false)}>
              Cancel
            </Button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing imported for this week"
            description={
              isAdmin
                ? "Import the week's Clockify time from the Payroll dashboard to create a row for each contractor."
                : "An administrator needs to import this week's time before it can be reviewed."
            }
          />
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1100px] border-collapse text-left">
              <thead style={{ background: "var(--canvas)" }}>
                <tr>
                  {["Contractor", "Pay type", "Hours", "Rate", "Amount", "Status", "Approved", "Invoice", ""].map(
                    (label, index) => (
                      <th
                        key={label || index}
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
                {rows.map((row) => {
                  const busy = pending.has(row.id);
                  const locked = row.invoiceNumber !== null;

                  return (
                    <tr
                      key={row.id}
                      className="border-t"
                      style={{ borderColor: "var(--line)", opacity: busy ? 0.6 : 1 }}
                    >
                      <td className="px-3 py-2 text-[12.5px] font-medium">
                        {row.contractorName}
                      </td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                        {PAY_TYPE_LABELS[row.payType]}
                      </td>
                      <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
                        {formatHours(row.clockifySeconds)}
                      </td>
                      <td className="px-3 py-2 text-right text-[12px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
                        {row.payType === "HOURLY"
                          ? `$${formatRate(row.hourlyRate ?? "0")}/h`
                          : `$${formatMoney(row.weeklyAmount ?? "0")}/wk`}
                      </td>
                      <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums">
                        ${formatMoney(row.invoiceAmount)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[11.5px] font-semibold"
                          style={{ color: STATUS_TONE[row.managerStatus] }}
                        >
                          {APPROVAL_STATUS_LABELS[row.managerStatus]}
                        </span>
                        {row.reviewNote ? (
                          <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                            {row.reviewNote}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
                        {row.approvedAt ? (
                          <>
                            {row.approvedByName ?? "account removed"}
                            <br />
                            {formatBusinessTimestamp(row.approvedAt)}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11.5px]">
                        {row.invoiceNumber ? (
                          <span className="tabular-nums">{row.invoiceNumber}</span>
                        ) : (
                          <span style={{ color: "var(--ink-subtle)" }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {locked ? (
                          // Changing an invoiced row would leave an invoice
                          // describing something no longer true, so the way
                          // back is voiding it rather than editing around it.
                          <Badge>invoiced</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <RowAction
                              label="Approve"
                              active={row.managerStatus === "APPROVED"}
                              tone="var(--success)"
                              disabled={busy}
                              onClick={() => setStatus(row, "APPROVED")}
                            />
                            <RowAction
                              label="Review"
                              active={row.managerStatus === "NEEDS_REVIEW"}
                              tone="var(--warn)"
                              disabled={busy}
                              onClick={() => setStatus(row, "NEEDS_REVIEW")}
                            />
                            <RowAction
                              label="Reject"
                              active={row.managerStatus === "REJECTED"}
                              tone="var(--danger)"
                              disabled={busy}
                              onClick={() => setStatus(row, "REJECTED")}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function RowAction({
  label,
  active,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className="rounded border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50"
      style={{
        borderColor: active ? "transparent" : "var(--line-strong)",
        background: active ? tone : "transparent",
        color: active ? "var(--surface)" : "var(--ink-muted)",
      }}
    >
      {label}
    </button>
  );
}
