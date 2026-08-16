/**
 * Invoice generation, payment tracking, and voiding.
 *
 * Duplicate prevention is the database's job. `invoice_number` is unique and a
 * partial unique index allows only one non-void invoice per contractor per
 * period, so a double-click, two managers pressing the button at once, or a
 * retried request cannot produce a second invoice — regardless of what this
 * code checks first.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";
import { auditActor } from "@/lib/auth/actor";
import { recordAudit } from "./audit";
import { conflict, notFound, validationError } from "@/lib/errors";
import {
  canGenerateInvoice,
  invoiceNumberFor,
  manualInvoiceNumberFor,
  roundMoney,
  validateInvoiceDraft,
  validateManualInvoice,
  type ApprovalStatus,
  type PayType,
} from "@/lib/domain/payroll";
import { dbDateFromPlainDate, plainDateFromDbDate, toPlainDate } from "@/lib/date/plain-date";
import { archiveInvoices } from "./invoice-archive";

export interface GenerateResult {
  generated: { invoiceNumber: string; contractorName: string; amount: string }[];
  /** Rows that could not be invoiced, and why. */
  skipped: { contractorName: string; reason: string }[];
  /** How many PDFs reached Google Drive, when archiving is switched on. */
  archived?: { uploaded: number; failed: number };
}

/**
 * Turns every approved, uninvoiced row in a period into an invoice.
 *
 * Each row is validated before it becomes money. The system this replaces once
 * wrote a Unix timestamp into an amount and a pay period in 1969; those rows
 * are rejected here with the reason, rather than generated and discovered
 * later by a contractor.
 */
export async function generateInvoicesForPeriod(
  payrollPeriodId: string,
  actor: ActorContext,
  options: { confirmLargeAmounts?: boolean } = {},
): Promise<GenerateResult> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payrollPeriodId } });
  if (!period) throw notFound("That pay period no longer exists.");

  const rows = await prisma.weeklyApproval.findMany({
    where: { payrollPeriodId },
    include: { contractor: true },
    orderBy: { contractor: { name: "asc" } },
  });

  const periodStart = plainDateFromDbDate(period.periodStart);
  const periodEnd = plainDateFromDbDate(period.periodEnd);

  const result: GenerateResult = { generated: [], skipped: [] };
  /** Ids of what this run created, so only those are filed into Drive. */
  const generatedIds: string[] = [];

  for (const row of rows) {
    if (
      !canGenerateInvoice({
        managerStatus: row.managerStatus as ApprovalStatus,
        invoiceId: row.invoiceId,
      })
    ) {
      // Not an error: most rows in a period are legitimately not eligible.
      if (row.invoiceId) {
        result.skipped.push({ contractorName: row.contractor.name, reason: "already invoiced" });
      } else {
        result.skipped.push({
          contractorName: row.contractor.name,
          reason: `not approved (${row.managerStatus.toLowerCase().replace("_", " ")})`,
        });
      }
      continue;
    }

    // Reissues after a void take the next revision. Counting every invoice
    // ever written for this contractor-week — void ones included — is what
    // keeps two documents from sharing a number.
    const priorInvoices = await prisma.invoice.count({
      where: { contractorId: row.contractorId, payrollPeriodId },
    });

    let invoiceNumber: string;
    try {
      invoiceNumber = invoiceNumberFor(
        row.contractor.invoicePrefix,
        periodStart,
        priorInvoices + 1,
      );
    } catch (error) {
      result.skipped.push({
        contractorName: row.contractor.name,
        reason: error instanceof Error ? error.message : "bad invoice prefix",
      });
      continue;
    }

    const problems = validateInvoiceDraft({
      invoiceNumber,
      contractorName: row.contractor.name,
      periodStart,
      periodEnd,
      payType: row.payType as PayType,
      amount: row.invoiceAmount,
    });

    // A large amount is a question, not a defect: it blocks unless the caller
    // has explicitly said they meant it.
    const blocking = options.confirmLargeAmounts
      ? problems.filter((problem) => !problem.includes("threshold"))
      : problems;

    if (blocking.length > 0) {
      result.skipped.push({ contractorName: row.contractor.name, reason: blocking.join(" ") });
      continue;
    }

    try {
      // One transaction: an invoice that exists but is not linked to its
      // approval row would be invisible to every screen that matters.
      const invoice = await prisma.$transaction(async (tx) => {
        const created = await tx.invoice.create({
          data: {
            invoiceNumber,
            contractorId: row.contractorId,
            payrollPeriodId,
            payType: row.payType,
            approvedSeconds: row.clockifySeconds,
            weeklyAmount: row.weeklyAmount,
            hourlyRate: row.hourlyRate,
            amount: row.invoiceAmount,
            depositDate: period.depositDate,
          },
        });

        await tx.weeklyApproval.update({
          where: { id: row.id },
          data: { invoiceId: created.id },
        });

        return created;
      });

      await recordAudit({
        ...auditActor(actor),
        entityType: "INVOICE",
        entityId: invoice.id,
        action: "GENERATED",
        newValue: {
          invoiceNumber,
          contractor: row.contractor.name,
          amount: invoice.amount.toFixed(2),
          periodStart,
        },
      });

      result.generated.push({
        invoiceNumber,
        contractorName: row.contractor.name,
        amount: invoice.amount.toFixed(2),
      });
      generatedIds.push(invoice.id);
    } catch (error) {
      // The unique constraints doing their job — another request got there
      // first. Reported rather than raised: the rest of the run should finish.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        result.skipped.push({
          contractorName: row.contractor.name,
          reason: "an invoice already exists for this week",
        });
        continue;
      }
      throw error;
    }
  }

  // Filing the PDFs happens after every invoice exists, and cannot undo any of
  // them. Drive being down means an invoice with no copy in the folder, which
  // the Invoices screen shows and an administrator can retry — not a payroll
  // run that failed.
  const outcomes = await archiveInvoices(generatedIds);
  if (outcomes.length > 0) {
    result.archived = {
      uploaded: outcomes.filter((outcome) => outcome.uploaded).length,
      failed: outcomes.filter((outcome) => !outcome.uploaded).length,
    };
  }

  return result;
}

/**
 * Raises a one-off invoice: a bonus, a reimbursement, anything not driven by
 * hours.
 *
 * Deliberately not routed through the approval flow. An approval row exists to
 * say "these hours are right", and there are no hours here — putting a bonus
 * through it would mean approving a week that was never worked. What replaces
 * that check is that only an administrator can raise one, every one is audited,
 * and the description is mandatory, so the reason travels with the money.
 *
 * It rides along with a pay period so it inherits that week's deposit date and
 * goes out with that week's remittance, which is how it actually gets paid.
 */
export async function createManualInvoice(
  input: {
    contractorId: string;
    payrollPeriodId: string;
    description: string;
    /** Decimal string, as it came off the form. */
    amount: string;
  },
  actor: ActorContext,
  options: { confirmLargeAmounts?: boolean } = {},
): Promise<{ invoiceNumber: string; amount: string; archived: boolean }> {
  const [contractor, period] = await Promise.all([
    prisma.contractor.findUnique({ where: { id: input.contractorId } }),
    prisma.payrollPeriod.findUnique({ where: { id: input.payrollPeriodId } }),
  ]);

  if (!contractor) throw notFound("That contractor no longer exists.");
  if (!period) throw notFound("That pay period no longer exists.");

  if (!contractor.active) {
    throw validationError(
      `${contractor.name} is not active. Reactivate them before raising an invoice.`,
    );
  }

  let amount: Decimal;
  try {
    amount = roundMoney(new Decimal(input.amount));
  } catch {
    throw validationError("Enter the amount as a plain number, for example 250.00.");
  }

  const periodStart = plainDateFromDbDate(period.periodStart);

  const problems = validateManualInvoice({
    contractorName: contractor.name,
    description: input.description,
    amount,
    periodStart,
  });

  // A large amount is a question, not a defect — the same treatment the payroll
  // path gives it.
  const blocking = options.confirmLargeAmounts
    ? problems.filter((problem) => !problem.includes("threshold"))
    : problems;

  if (blocking.length > 0) throw validationError(blocking.join(" "));

  // Numbered by how many manual invoices this contractor already has for this
  // week, void ones included — the number identifies a document, so one that
  // existed must not have its number handed to another.
  const priorManual = await prisma.invoice.count({
    where: {
      contractorId: input.contractorId,
      payrollPeriodId: input.payrollPeriodId,
      kind: "MANUAL",
    },
  });

  const invoiceNumber = manualInvoiceNumberFor(
    contractor.invoicePrefix,
    periodStart,
    priorManual + 1,
  );

  let invoice;
  try {
    invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        kind: "MANUAL",
        contractorId: input.contractorId,
        payrollPeriodId: input.payrollPeriodId,
        description: input.description.trim(),
        // No pay type, no hours, no rate: the database refuses a manual
        // invoice that carries any of them.
        payType: null,
        approvedSeconds: 0,
        amount,
        depositDate: period.depositDate,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("Another invoice with that number was just created. Try again.");
    }
    throw error;
  }

  await recordAudit({
    ...auditActor(actor),
    entityType: "INVOICE",
    entityId: invoice.id,
    action: "MANUAL_CREATED",
    newValue: {
      invoiceNumber,
      contractor: contractor.name,
      description: input.description.trim(),
      amount: amount.toFixed(2),
      periodStart,
    },
  });

  const [outcome] = await archiveInvoices([invoice.id]);

  return {
    invoiceNumber,
    amount: amount.toFixed(2),
    archived: outcome?.uploaded ?? false,
  };
}

export async function listInvoices(filters: { payrollPeriodId?: string } = {}) {
  return prisma.invoice.findMany({
    where: filters.payrollPeriodId ? { payrollPeriodId: filters.payrollPeriodId } : {},
    include: {
      contractor: { select: { name: true, invoicePrefix: true, remittanceEmail: true } },
      payrollPeriod: { select: { periodStart: true, periodEnd: true } },
    },
    orderBy: [{ generatedAt: "desc" }],
  });
}

/** Records a USDT payment against an invoice. */
export async function markInvoicePaid(
  invoiceId: string,
  input: { paymentDate: string; usdtTxHash: string },
  actor: ActorContext,
) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw notFound("That invoice no longer exists.");
  if (invoice.status === "VOID") throw conflict("That invoice has been voided.");

  const hash = input.usdtTxHash.trim();
  if (hash === "") {
    // The transaction hash is the evidence. "Paid" without it is the audit
    // hole this module exists to close.
    throw validationError("Enter the USDT transaction hash.");
  }

  const paymentDate = toPlainDate(input.paymentDate);

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "PAID",
      paymentDate: dbDateFromPlainDate(paymentDate),
      usdtTxHash: hash,
    },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "INVOICE",
    entityId: invoiceId,
    action: "MARKED_PAID",
    oldValue: { status: invoice.status },
    newValue: { status: "PAID", paymentDate, usdtTxHash: hash },
  });

  return updated;
}

export async function markInvoiceSent(invoiceId: string, actor: ActorContext) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw notFound("That invoice no longer exists.");
  if (invoice.status !== "GENERATED") {
    throw conflict(`That invoice is ${invoice.status.toLowerCase()}, not newly generated.`);
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "SENT" },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "INVOICE",
    entityId: invoiceId,
    action: "MARKED_SENT",
    oldValue: { status: invoice.status },
    newValue: { status: "SENT" },
  });

  return updated;
}

/**
 * Voids an invoice, freeing its week to be reissued.
 *
 * Nothing is deleted. The void keeps its reason and timestamp, and the partial
 * unique index excludes voided rows so a corrected invoice can take the same
 * number — which is what makes the number mean "this contractor, this week"
 * rather than "the nth attempt".
 */
export async function voidInvoice(invoiceId: string, reason: string, actor: ActorContext) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { approval: { select: { id: true } } },
  });
  if (!invoice) throw notFound("That invoice no longer exists.");
  if (invoice.status === "VOID") throw conflict("That invoice is already void.");

  const trimmed = reason.trim();
  if (trimmed === "") throw validationError("Give a reason for voiding this invoice.");

  const updated = await prisma.$transaction(async (tx) => {
    const voided = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "VOID", voidedAt: new Date(), voidReason: trimmed },
    });

    // Release the approval row so the week can be corrected and reissued.
    if (invoice.approval) {
      await tx.weeklyApproval.update({
        where: { id: invoice.approval.id },
        data: { invoiceId: null },
      });
    }

    return voided;
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "INVOICE",
    entityId: invoiceId,
    action: "VOIDED",
    oldValue: { status: invoice.status, amount: invoice.amount.toFixed(2) },
    newValue: { status: "VOID", reason: trimmed },
  });

  return updated;
}

/** Totals for a payroll run, for the summary line and the export. */
export function invoiceTotals(invoices: { amount: Decimal; status: string }[]) {
  const live = invoices.filter((invoice) => invoice.status !== "VOID");
  const sum = (rows: { amount: Decimal }[]) =>
    rows.reduce((total, row) => total.plus(row.amount), new Decimal(0));

  return {
    count: live.length,
    total: sum(live),
    paid: sum(live.filter((invoice) => invoice.status === "PAID")),
    outstanding: sum(live.filter((invoice) => invoice.status !== "PAID")),
  };
}
