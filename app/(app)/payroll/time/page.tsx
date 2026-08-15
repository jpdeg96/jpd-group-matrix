import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { prisma } from "@/lib/db/prisma";
import { ensurePayPeriod, listPayPeriods } from "@/lib/services/payroll";
import { businessToday } from "@/lib/services/settings";
import { priorPayPeriod } from "@/lib/domain/payroll";
import { plainDateFromDbDate, toPlainDate } from "@/lib/date/plain-date";
import { ImportedTimeView } from "@/components/payroll/imported-time-view";

export const dynamic = "force-dynamic";

/**
 * The raw audit trail.
 *
 * Every Clockify entry that fed a pay calculation, exactly as it arrived. This
 * is what makes a disputed week answerable: not "the total was 41.49" but the
 * individual shifts that added up to it.
 */
export default async function ImportedTimePage({
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
      redirect("/payroll/time");
    }
  }

  const period = await ensurePayPeriod(target);

  const [entries, periods] = await Promise.all([
    prisma.importedTimeEntry.findMany({
      where: { payrollPeriodId: period.id },
      include: { contractor: { select: { name: true } } },
      orderBy: [{ startTime: "asc" }],
    }),
    listPayPeriods(),
  ]);

  return (
    <ImportedTimeView
      period={{
        periodStart: plainDateFromDbDate(period.periodStart),
        periodEnd: plainDateFromDbDate(period.periodEnd),
      }}
      periods={periods.map((row) => ({
        id: row.id,
        periodStart: plainDateFromDbDate(row.periodStart),
        periodEnd: plainDateFromDbDate(row.periodEnd),
      }))}
      entries={entries.map((entry) => ({
        id: entry.id,
        contractorName: entry.contractor.name,
        startTime: entry.startTime.toISOString(),
        endTime: entry.endTime.toISOString(),
        durationSeconds: entry.durationSeconds,
        description: entry.description,
        clockifyEntryId: entry.clockifyEntryId,
        importedAt: entry.importedAt.toISOString(),
      }))}
    />
  );
}
