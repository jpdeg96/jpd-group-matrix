import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { ensurePayPeriod, listApprovals, listPayPeriods } from "@/lib/services/payroll";
import { businessToday } from "@/lib/services/settings";
import { priorPayPeriod } from "@/lib/domain/payroll";
import { plainDateFromDbDate, toPlainDate } from "@/lib/date/plain-date";
import { ApprovalsView } from "@/components/payroll/approvals-view";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

  const { period: requested } = await searchParams;

  const today = await businessToday();
  let target = priorPayPeriod(today).start;
  if (requested) {
    try {
      target = toPlainDate(requested);
    } catch {
      redirect("/payroll/approvals");
    }
  }

  const period = await ensurePayPeriod(target);
  const [rows, periods] = await Promise.all([listApprovals(period.id), listPayPeriods()]);

  return (
    <ApprovalsView
      isAdmin={actor.effective.role === "ADMIN"}
      period={{
        id: period.id,
        periodStart: plainDateFromDbDate(period.periodStart),
        periodEnd: plainDateFromDbDate(period.periodEnd),
        depositDate: plainDateFromDbDate(period.depositDate),
      }}
      periods={periods.map((row) => ({
        id: row.id,
        periodStart: plainDateFromDbDate(row.periodStart),
        periodEnd: plainDateFromDbDate(row.periodEnd),
      }))}
      rows={rows.map((row) => ({
        id: row.id,
        contractorName: row.contractor.name,
        invoicePrefix: row.contractor.invoicePrefix,
        payType: row.payType,
        clockifySeconds: row.clockifySeconds,
        weeklyAmount: row.weeklyAmount?.toFixed(2) ?? null,
        hourlyRate: row.hourlyRate?.toFixed(4) ?? null,
        invoiceAmount: row.invoiceAmount.toFixed(2),
        managerStatus: row.managerStatus,
        approvedByName: row.approvedBy?.displayName ?? null,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        reviewNote: row.reviewNote,
        invoiceNumber: row.invoice?.invoiceNumber ?? null,
        invoiceStatus: row.invoice?.status ?? null,
      }))}
    />
  );
}
