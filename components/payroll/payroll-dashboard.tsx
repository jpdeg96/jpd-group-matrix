"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, PageHeader, StatPill } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { formatPlainDate } from "@/lib/date/plain-date";
import { formatHours, formatMoney } from "@/lib/domain/payroll-format";
import type { PlainDate } from "@/lib/date/plain-date";

interface Summary {
  periodStart: PlainDate;
  periodEnd: PlainDate;
  depositDate: PlainDate;
  contractors: number;
  totalSeconds: number;
  pending: number;
  approved: number;
  rejected: number;
  needsReview: number;
  invoiced: number;
  approvedTotal: string;
  invoicedTotal: string;
  paidTotal: string;
}

interface PeriodOption {
  id: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  depositDate: PlainDate;
}

interface ImportResult {
  entriesImported: number;
  runningSkipped: number;
  approvalsCreated: number;
  approvalsUpdated: number;
  approvalsFrozen: number;
  failures: { contractorName: string; message: string }[];
}

/**
 * The Monday screen.
 *
 * Deliberately shows the deposit date as a full date rather than "Friday" —
 * that date is a promise made to people about when money arrives, and a
 * weekday alone is exactly the ambiguity that makes someone ask.
 */
export function PayrollDashboard({
  isAdmin,
  periodId,
  summary,
  periods,
}: {
  isAdmin: boolean;
  periodId: string;
  summary: Summary;
  periods: PeriodOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function importWeek() {
    setBusy("import");
    try {
      const { result } = await api.post<{ result: ImportResult }>("/api/payroll/import", {
        periodStart: summary.periodStart,
      });

      const parts = [
        `${result.entriesImported} time ${result.entriesImported === 1 ? "entry" : "entries"}`,
        `${result.approvalsCreated} new`,
        `${result.approvalsUpdated} updated`,
      ];
      if (result.approvalsFrozen > 0) parts.push(`${result.approvalsFrozen} left alone`);

      toast.success(`Imported: ${parts.join(", ")}.`);

      // A running timer is not an error, but it is money nobody will be paid
      // for unless somebody stops it — so it is said out loud.
      if (result.runningSkipped > 0) {
        toast.toast(
          `${result.runningSkipped} timer${result.runningSkipped === 1 ? " is" : "s are"} still running and were not imported.`,
          { tone: "info" },
        );
      }
      for (const failure of result.failures) {
        toast.error(`${failure.contractorName}: ${failure.message}`);
      }

      router.refresh();
    } catch (error) {
      toast.error(
        "Import failed.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  async function generateInvoices() {
    setBusy("generate");
    try {
      const { result } = await api.post<{
        result: {
          generated: { invoiceNumber: string; contractorName: string; amount: string }[];
          skipped: { contractorName: string; reason: string }[];
        };
      }>("/api/payroll/invoices", { payrollPeriodId: periodId });

      if (result.generated.length === 0) {
        toast.toast("No invoices generated — nothing is approved and uninvoiced.", {
          tone: "info",
        });
      } else {
        toast.success(
          `Generated ${result.generated.length} invoice${result.generated.length === 1 ? "" : "s"}.`,
        );
      }

      // Only the refusals worth acting on: "not approved" is the normal state
      // of most rows and would drown the real problems.
      for (const skip of result.skipped.filter((s) => !s.reason.startsWith("not approved"))) {
        toast.toast(`${skip.contractorName}: ${skip.reason}`, { tone: "info" });
      }

      router.refresh();
    } catch (error) {
      toast.error(
        "Could not generate invoices.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  const outstanding = summary.pending + summary.needsReview;

  return (
    <div className="space-y-4">
      <Card>
        <PageHeader
          title="Payroll"
          subtitle={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-[12.5px] font-medium">
                {formatPlainDate(summary.periodStart)} – {formatPlainDate(summary.periodEnd)}
              </span>
              <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
                Deposit {formatPlainDate(summary.depositDate)}
              </span>
            </div>
          }
          actions={
            <>
              <select
                value={summary.periodStart}
                onChange={(event) => router.push(`/payroll?period=${event.target.value}`)}
                aria-label="Pay period"
                className="rounded-md border px-2 py-1 text-[12px]"
                style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
              >
                {periods.map((period) => (
                  <option key={period.id} value={period.periodStart}>
                    {formatPlainDate(period.periodStart)} – {formatPlainDate(period.periodEnd)}
                  </option>
                ))}
              </select>

              {isAdmin ? (
                <>
                  <Button size="sm" onClick={importWeek} loading={busy === "import"}>
                    Import time
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={generateInvoices}
                    loading={busy === "generate"}
                    disabled={summary.approved === 0}
                    title={
                      summary.approved === 0
                        ? "Nothing is approved yet"
                        : "Generate invoices for every approved row"
                    }
                  >
                    Generate invoices
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          <StatPill label="contractors" value={summary.contractors} />
          <StatPill label="hours" value={formatHours(summary.totalSeconds)} />
          <StatPill
            label="awaiting review"
            value={outstanding}
            tone={outstanding > 0 ? "warn" : undefined}
          />
          <StatPill label="approved" value={summary.approved} tone="success" />
          <StatPill label="invoiced" value={summary.invoiced} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <MoneyCard
          title="Approved this week"
          amount={summary.approvedTotal}
          hint="What managers have signed off, before invoicing."
        />
        <MoneyCard
          title="Invoiced"
          amount={summary.invoicedTotal}
          hint="Live invoices for this week. Voided ones are excluded."
        />
        <MoneyCard
          title="Paid"
          amount={summary.paidTotal}
          hint="Recorded against a USDT transaction hash."
        />
      </div>

      <Card>
        <PageHeader
          title="This week"
          subtitle={
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              Import on Monday, review, then generate invoices. Pay on{" "}
              {formatPlainDate(summary.depositDate)}.
            </span>
          }
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Link
            href="/payroll/approvals"
            className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}
          >
            Review {outstanding > 0 ? `${outstanding} row${outstanding === 1 ? "" : "s"}` : "weekly approval"}
          </Link>
          <Link
            href="/payroll/invoices"
            className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}
          >
            Invoices
          </Link>
        </div>
      </Card>
    </div>
  );
}

function MoneyCard({
  title,
  amount,
  hint,
}: {
  title: string;
  amount: string;
  hint: string;
}) {
  return (
    <Card>
      <div className="px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
          {title}
        </p>
        <p className="mt-1 text-[22px] font-semibold tabular-nums">
          ${formatMoney(amount)}
        </p>
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          {hint}
        </p>
      </div>
    </Card>
  );
}
