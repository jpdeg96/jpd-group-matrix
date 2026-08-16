import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { canAssignOthers } from "@/lib/domain/constants";
import { listInvoices } from "@/lib/services/invoices";
import { isArchivingEnabled } from "@/lib/services/invoice-archive";
import { plainDateFromDbDate } from "@/lib/date/plain-date";
import { InvoicesView } from "@/components/payroll/invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

  const [invoices, driveEnabled, contractors, periods] = await Promise.all([
    listInvoices(),
    isArchivingEnabled(),
    // Only active contractors: raising a bonus for someone who has left is
    // almost always a mistake, and the service refuses it anyway.
    prisma.contractor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Most recent first, so the week a bonus usually belongs to is preselected.
    prisma.payrollPeriod.findMany({
      orderBy: { periodStart: "desc" },
      take: 26,
      select: { id: true, periodStart: true, periodEnd: true, depositDate: true },
    }),
  ]);

  return (
    <InvoicesView
      isAdmin={actor.effective.role === "ADMIN"}
      driveEnabled={driveEnabled}
      contractors={contractors}
      periods={periods.map((period) => ({
        id: period.id,
        periodStart: plainDateFromDbDate(period.periodStart),
        periodEnd: plainDateFromDbDate(period.periodEnd),
        depositDate: plainDateFromDbDate(period.depositDate),
      }))}
      invoices={invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contractorName: invoice.contractor.name,
        periodStart: plainDateFromDbDate(invoice.payrollPeriod.periodStart),
        periodEnd: plainDateFromDbDate(invoice.payrollPeriod.periodEnd),
        kind: invoice.kind,
        payType: invoice.payType,
        description: invoice.description,
        approvedSeconds: invoice.approvedSeconds,
        amount: invoice.amount.toFixed(2),
        status: invoice.status,
        depositDate: plainDateFromDbDate(invoice.depositDate),
        paymentDate: invoice.paymentDate ? plainDateFromDbDate(invoice.paymentDate) : null,
        usdtTxHash: invoice.usdtTxHash,
        voidReason: invoice.voidReason,
        driveWebLink: invoice.driveWebLink,
        driveError: invoice.driveError,
        generatedAt: invoice.generatedAt.toISOString(),
      }))}
    />
  );
}
