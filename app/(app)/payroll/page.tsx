import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import {
  ensurePayPeriod,
  getPayrollSummary,
  listPayPeriods,
} from "@/lib/services/payroll";
import { businessToday } from "@/lib/services/settings";
import { priorPayPeriod } from "@/lib/domain/payroll";
import { plainDateFromDbDate, toPlainDate } from "@/lib/date/plain-date";
import { PayrollDashboard } from "@/components/payroll/payroll-dashboard";
import { can } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!can(actor, "payroll.view")) redirect("/dashboard");

  const { period: requested } = await searchParams;

  // Defaults to the week that just finished, which is the week Monday's
  // payroll run is about. Creating the row on view is harmless and means the
  // screen is never empty on a Monday morning.
  //
  // The query parameter is parsed rather than trusted: `?period=nonsense`
  // would otherwise throw out of `toPlainDate` and render an error page for
  // what is really just a bad link.
  const today = await businessToday();
  let target = priorPayPeriod(today).start;
  if (requested) {
    try {
      target = toPlainDate(requested);
    } catch {
      redirect("/payroll");
    }
  }

  const period = await ensurePayPeriod(target);

  const [summary, periods] = await Promise.all([
    getPayrollSummary(period.id),
    listPayPeriods(),
  ]);

  return (
    <PayrollDashboard
      canInvoice={can(actor, "payroll.invoice")}
      canRemit={can(actor, "payroll.remit")}
      periodId={period.id}
      summary={{
        ...summary,
        approvedTotal: summary.approvedTotal.toFixed(2),
        invoicedTotal: summary.invoicedTotal.toFixed(2),
        paidTotal: summary.paidTotal.toFixed(2),
      }}
      periods={periods.map((row) => ({
        id: row.id,
        periodStart: plainDateFromDbDate(row.periodStart),
        periodEnd: plainDateFromDbDate(row.periodEnd),
        depositDate: plainDateFromDbDate(row.depositDate),
      }))}
    />
  );
}
