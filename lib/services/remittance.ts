/**
 * Remittance emails: one to each contractor, one summary to the administrator.
 *
 * The safeguard that matters most here is *which* period may be sent. The
 * system this replaces could be pointed at any row in a spreadsheet, and a
 * mis-click mailed contractors about a week that had already been paid — or
 * worse, about a corrupted row. Sending is therefore restricted to the most
 * recent pay period unless somebody explicitly overrides it.
 *
 * Sending is also recorded per invoice, so a retry after a partial failure
 * does not mail the people who already received theirs.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";
import { auditActor } from "@/lib/auth/actor";
import { recordAudit } from "./audit";
import { conflict, notFound, validationError } from "@/lib/errors";
import { getSettings } from "./settings";
import { buildInvoicePdf } from "./invoice-pdf";
import { isEmailConfigured, sendEmail } from "@/lib/email/client";
import { formatPlainDate, plainDateFromDbDate, type PlainDate } from "@/lib/date/plain-date";
import {
  formatHours,
  formatMoney,
  PAY_TYPE_LABELS,
  type PayType,
} from "@/lib/domain/payroll-format";
import { notify } from "@/lib/notify/discord";
import { payrollMessage } from "@/lib/notify/messages";

export interface RemittanceResult {
  sent: string[];
  skipped: { contractorName: string; reason: string }[];
  failed: { contractorName: string; reason: string }[];
  adminSummarySent: boolean;
  adminSummaryError: string | null;
}

/**
 * Sends remittance for one pay period.
 *
 * `allowOlderPeriod` exists because reissuing a corrected invoice for an
 * earlier week is legitimate — but it has to be asked for, so that the default
 * path cannot quietly mail last quarter.
 */
export async function sendRemittanceForPeriod(
  payrollPeriodId: string,
  actor: ActorContext,
  options: { allowOlderPeriod?: boolean; resend?: boolean } = {},
): Promise<RemittanceResult> {
  if (!isEmailConfigured()) {
    throw validationError(
      "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server.",
    );
  }

  const settings = await getSettings();

  const period = await prisma.payrollPeriod.findUnique({ where: { id: payrollPeriodId } });
  if (!period) throw notFound("That pay period no longer exists.");

  if (!options.allowOlderPeriod) {
    const latest = await prisma.payrollPeriod.findFirst({
      orderBy: { periodStart: "desc" },
      select: { id: true, periodStart: true },
    });

    if (latest && latest.id !== payrollPeriodId) {
      throw conflict(
        `That is not the latest pay period. The most recent is ${formatPlainDate(
          plainDateFromDbDate(latest.periodStart),
        )}. Confirm explicitly to send for an older week.`,
      );
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: { payrollPeriodId, status: { not: "VOID" } },
    include: { contractor: { select: { name: true, remittanceEmail: true } } },
    orderBy: { contractor: { name: "asc" } },
  });

  const result: RemittanceResult = {
    sent: [],
    skipped: [],
    failed: [],
    adminSummarySent: false,
    adminSummaryError: null,
  };

  const periodStart = plainDateFromDbDate(period.periodStart);
  const periodEnd = plainDateFromDbDate(period.periodEnd);
  const depositDate = plainDateFromDbDate(period.depositDate);

  for (const invoice of invoices) {
    const email = invoice.contractor.remittanceEmail;

    if (!email) {
      result.skipped.push({
        contractorName: invoice.contractor.name,
        reason: "no remittance email on file",
      });
      continue;
    }

    // Already sent, and this is not a deliberate resend.
    if (invoice.remittanceSent && !options.resend) {
      result.skipped.push({
        contractorName: invoice.contractor.name,
        reason: "already sent",
      });
      continue;
    }

    try {
      const pdf = await buildInvoicePdf(invoice.id);

      const body = contractorEmail({
        contractorName: invoice.contractor.name,
        businessName: settings.businessName,
        invoiceNumber: invoice.invoiceNumber,
        periodStart,
        periodEnd,
        depositDate,
        payType: invoice.payType as PayType,
        approvedSeconds: invoice.approvedSeconds,
        amount: invoice.amount.toFixed(2),
        paymentMethod: settings.remittancePaymentMethod,
        footerNote: settings.remittanceFooterNote,
      });

      await sendEmail({
        to: email,
        subject: `${settings.businessName} — payment for ${formatPlainDate(periodStart)} to ${formatPlainDate(periodEnd)}`,
        html: body.html,
        text: body.text,
        fromName: settings.remittanceFromName,
        attachments: [
          { filename: pdf.filename, content: pdf.bytes.toString("base64") },
        ],
      });

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          remittanceSent: true,
          remittanceSentAt: new Date(),
          remittanceError: null,
          lastRemittanceCheck: new Date(),
        },
      });

      result.sent.push(invoice.contractor.name);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "could not send";

      // Recorded on the invoice rather than only reported, so a failure is
      // still visible tomorrow when nobody is looking at this screen.
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { remittanceError: reason, lastRemittanceCheck: new Date() },
      });

      result.failed.push({ contractorName: invoice.contractor.name, reason });
    }
  }

  // The administrator's summary goes last, so it reports what actually
  // happened rather than what was about to be attempted.
  if (settings.adminRemittanceEmail) {
    try {
      const summary = adminSummaryEmail({
        businessName: settings.businessName,
        periodStart,
        periodEnd,
        depositDate,
        rows: invoices.map((invoice) => ({
          contractorName: invoice.contractor.name,
          invoiceNumber: invoice.invoiceNumber,
          payType: invoice.payType as PayType,
          approvedSeconds: invoice.approvedSeconds,
          amount: invoice.amount.toFixed(2),
          status: invoice.status,
        })),
        total: invoices
          .reduce((sum, invoice) => sum.plus(invoice.amount), new Decimal(0))
          .toFixed(2),
        sent: result.sent.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
      });

      await sendEmail({
        to: settings.adminRemittanceEmail,
        subject: `Payroll summary — ${formatPlainDate(periodStart)} to ${formatPlainDate(periodEnd)}`,
        html: summary.html,
        text: summary.text,
        fromName: settings.remittanceFromName,
      });

      result.adminSummarySent = true;
    } catch (error) {
      result.adminSummaryError =
        error instanceof Error ? error.message : "could not send the summary";
    }
  }

  await recordAudit({
    ...auditActor(actor),
    entityType: "PAYROLL_PERIOD",
    entityId: payrollPeriodId,
    action: "REMITTANCE_SENT",
    newValue: {
      periodStart,
      sent: result.sent.length,
      skipped: result.skipped.length,
      failed: result.failed.length,
      adminSummarySent: result.adminSummarySent,
    },
  });

  // Announced after the audit entry, and never allowed to affect the outcome:
  // the money has been sent by this point, and a chat message failing must not
  // present itself as a failed payroll run.
  if (settings.discordEnabled) {
    await notify(
      payrollMessage({
        periodLabel: `${formatPlainDate(periodStart)} – ${formatPlainDate(periodEnd)}`,
        sent: result.sent.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
        total: `$${formatMoney(
          invoices
            .reduce((sum, invoice) => sum.plus(invoice.amount), new Decimal(0))
            .toFixed(2),
        )}`,
        sentBy: actor.effective.displayName,
      }),
    );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface ContractorEmailInput {
  contractorName: string;
  businessName: string;
  invoiceNumber: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  depositDate: PlainDate;
  payType: PayType;
  approvedSeconds: number;
  amount: string;
  paymentMethod: string;
  footerNote: string | null;
}

export function contractorEmail(input: ContractorEmailInput): { html: string; text: string } {
  const week = `${formatPlainDate(input.periodStart)} — ${formatPlainDate(input.periodEnd)}`;
  // The full date, never "Friday": this is the promise about when money lands.
  const deposit = formatPlainDate(input.depositDate);
  const hours = formatHours(input.approvedSeconds);
  const amount = `$${formatMoney(input.amount)}`;

  const lines = [
    `Hi ${input.contractorName},`,
    "",
    `Your payment for ${week} has been approved.`,
    "",
    `Amount:        ${amount}`,
    `Deposit date:  ${deposit}`,
    `Payment method: ${input.paymentMethod}`,
    `Pay type:      ${PAY_TYPE_LABELS[input.payType]}`,
    `Approved hours: ${hours}`,
    `Invoice:       ${input.invoiceNumber}`,
    "",
    "Your invoice is attached.",
    ...(input.footerNote ? ["", input.footerNote] : []),
    "",
    input.businessName,
  ];

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;max-width:560px">
  <p>Hi ${escapeHtml(input.contractorName)},</p>
  <p>Your payment for <strong>${escapeHtml(week)}</strong> has been approved.</p>
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Amount</td><td style="padding:4px 0;font-weight:600;font-size:16px">${escapeHtml(amount)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Deposit date</td><td style="padding:4px 0">${escapeHtml(deposit)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Payment method</td><td style="padding:4px 0">${escapeHtml(input.paymentMethod)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Pay type</td><td style="padding:4px 0">${escapeHtml(PAY_TYPE_LABELS[input.payType])}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Approved hours</td><td style="padding:4px 0">${escapeHtml(hours)}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Invoice</td><td style="padding:4px 0">${escapeHtml(input.invoiceNumber)}</td></tr>
  </table>
  <p style="color:#6b7280;font-size:13px">Your invoice is attached.</p>
  ${input.footerNote ? `<p style="color:#6b7280;font-size:13px">${escapeHtml(input.footerNote)}</p>` : ""}
  <p style="margin-top:24px">${escapeHtml(input.businessName)}</p>
</div>`.trim();

  return { html, text: lines.join("\n") };
}

interface AdminSummaryInput {
  businessName: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  depositDate: PlainDate;
  rows: {
    contractorName: string;
    invoiceNumber: string;
    payType: PayType;
    approvedSeconds: number;
    amount: string;
    status: string;
  }[];
  total: string;
  sent: number;
  skipped: number;
  failed: number;
}

export function adminSummaryEmail(input: AdminSummaryInput): { html: string; text: string } {
  const week = `${formatPlainDate(input.periodStart)} — ${formatPlainDate(input.periodEnd)}`;

  const textRows = input.rows.map(
    (row) =>
      `${row.contractorName.padEnd(18)} ${row.invoiceNumber.padEnd(16)} ${PAY_TYPE_LABELS[row.payType].padEnd(12)} ${formatHours(row.approvedSeconds).padStart(7)} ${`$${formatMoney(row.amount)}`.padStart(11)}  ${row.status}`,
  );

  const text = [
    `Payroll summary — ${week}`,
    `Deposit date: ${formatPlainDate(input.depositDate)}`,
    "",
    ...textRows,
    "",
    `TOTAL: $${formatMoney(input.total)}`,
    "",
    `Emails sent: ${input.sent}, skipped: ${input.skipped}, failed: ${input.failed}`,
  ].join("\n");

  const htmlRows = input.rows
    .map(
      (row) => `
    <tr>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(row.contractorName)}</td>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;font-family:ui-monospace,monospace;font-size:12px">${escapeHtml(row.invoiceNumber)}</td>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(PAY_TYPE_LABELS[row.payType])}</td>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(formatHours(row.approvedSeconds))}</td>
      <td style="padding:6px 12px 6px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">$${escapeHtml(formatMoney(row.amount))}</td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">${escapeHtml(row.status)}</td>
    </tr>`,
    )
    .join("");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;max-width:720px">
  <h2 style="font-size:16px;margin:0 0 4px">Payroll summary — ${escapeHtml(week)}</h2>
  <p style="color:#6b7280;font-size:13px;margin:0 0 16px">Deposit date ${escapeHtml(formatPlainDate(input.depositDate))}</p>
  <table style="border-collapse:collapse;font-size:13px;width:100%">
    <thead>
      <tr style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase">
        <th style="padding:0 12px 6px 0">Contractor</th>
        <th style="padding:0 12px 6px 0">Invoice</th>
        <th style="padding:0 12px 6px 0">Pay type</th>
        <th style="padding:0 12px 6px 0;text-align:right">Hours</th>
        <th style="padding:0 12px 6px 0;text-align:right">Amount</th>
        <th style="padding:0 0 6px">Status</th>
      </tr>
    </thead>
    <tbody>${htmlRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="padding:10px 12px 0 0;text-align:right;font-weight:600">Total</td>
        <td style="padding:10px 12px 0 0;text-align:right;font-weight:700;font-size:15px">$${escapeHtml(formatMoney(input.total))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  <p style="color:#6b7280;font-size:12px;margin-top:16px">
    Emails sent: ${input.sent} · skipped: ${input.skipped} · failed: ${input.failed}
  </p>
</div>`.trim();

  return { html, text };
}
