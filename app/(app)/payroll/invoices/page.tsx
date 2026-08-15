import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { listInvoices } from "@/lib/services/invoices";
import { plainDateFromDbDate } from "@/lib/date/plain-date";
import { InvoicesView } from "@/components/payroll/invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

  const invoices = await listInvoices();

  return (
    <InvoicesView
      isAdmin={actor.effective.role === "ADMIN"}
      invoices={invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contractorName: invoice.contractor.name,
        periodStart: plainDateFromDbDate(invoice.payrollPeriod.periodStart),
        periodEnd: plainDateFromDbDate(invoice.payrollPeriod.periodEnd),
        payType: invoice.payType,
        approvedSeconds: invoice.approvedSeconds,
        amount: invoice.amount.toFixed(2),
        status: invoice.status,
        depositDate: plainDateFromDbDate(invoice.depositDate),
        paymentDate: invoice.paymentDate ? plainDateFromDbDate(invoice.paymentDate) : null,
        usdtTxHash: invoice.usdtTxHash,
        voidReason: invoice.voidReason,
        generatedAt: invoice.generatedAt.toISOString(),
      }))}
    />
  );
}
