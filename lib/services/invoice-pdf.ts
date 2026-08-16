/**
 * Assembles the data an invoice PDF needs and renders it.
 *
 * Every figure comes from the invoice row's own snapshot rather than from the
 * contractor's current rate, so a raise cannot restate a document that has
 * already been issued and paid.
 */

import { prisma } from "@/lib/db/prisma";
import { notFound } from "@/lib/errors";
import { getSettings } from "./settings";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { plainDateFromDbDate } from "@/lib/date/plain-date";
import { driveFileNameFor } from "@/lib/domain/payroll";
import type { PayType } from "@/lib/domain/payroll-format";

export async function buildInvoicePdf(invoiceId: string): Promise<{
  bytes: Buffer;
  /** What a browser saves it as. Keyed to the invoice number people quote. */
  filename: string;
  /**
   * What it is filed as in Drive: `YYMMDD INV-NUMBER.pdf`, dated by deposit.
   * Different from `filename` on purpose — a download wants the name someone
   * asked for, a shared folder wants to sort by payment run.
   */
  driveFilename: string;
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      contractor: { select: { name: true } },
      payrollPeriod: { select: { periodStart: true, periodEnd: true } },
      approval: {
        select: {
          approvedAt: true,
          approvedBy: { select: { displayName: true } },
        },
      },
    },
  });

  if (!invoice) throw notFound("That invoice no longer exists.");

  const settings = await getSettings();

  const bytes = await renderInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    generatedAt: invoice.generatedAt,
    contractorName: invoice.contractor.name,
    businessName: settings.businessName,
    businessAddress: settings.businessAddress,
    periodStart: plainDateFromDbDate(invoice.payrollPeriod.periodStart),
    periodEnd: plainDateFromDbDate(invoice.payrollPeriod.periodEnd),
    depositDate: plainDateFromDbDate(invoice.depositDate),
    payType: invoice.payType as PayType | null,
    description: invoice.description,
    approvedSeconds: invoice.approvedSeconds,
    hourlyRate: invoice.hourlyRate?.toFixed(4) ?? null,
    weeklyAmount: invoice.weeklyAmount?.toFixed(2) ?? null,
    amount: invoice.amount.toFixed(2),
    status: invoice.status,
    // The approval row is released when an invoice is voided, so a reissued
    // invoice may have no approval attached. Falling back keeps the document
    // honest rather than claiming an approval it cannot evidence.
    approvedByName: invoice.approval?.approvedBy?.displayName ?? null,
    approvedAt: invoice.approval?.approvedAt ?? null,
    paymentMethod: settings.remittancePaymentMethod,
    invoiceNote: settings.invoiceNote,
  });

  const depositDate = plainDateFromDbDate(invoice.depositDate);

  return {
    bytes,
    filename: `${invoice.invoiceNumber}.pdf`,
    driveFilename: driveFileNameFor(invoice.invoiceNumber, depositDate),
  };
}
