/**
 * Payroll: pay periods, Clockify import, and manager approval.
 *
 * The arithmetic and calendar rules live in `lib/domain/payroll.ts`, which has
 * no database. This module is the part that reads Clockify and writes rows.
 *
 * ## Idempotency
 *
 * Importing a week twice is normal — a timer gets corrected, someone forgets to
 * stop one on Friday. Re-import is therefore safe by construction rather than
 * by care: raw entries are upserted on Clockify's own entry id (a unique
 * column), and an approval row is only refreshed while nobody has committed to
 * it. Once a manager approves a week, or an invoice exists, the numbers are
 * frozen — a later import cannot silently restate what someone was paid.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";
import { auditActor } from "@/lib/auth/actor";
import { recordAudit } from "./audit";
import { conflict, notFound, validationError } from "@/lib/errors";
import { getSettings, businessToday } from "./settings";
import { getTimeEntries, isClockifyConfigured } from "@/lib/clockify/client";
import { startOfBusinessDay } from "./clockify";
import {
  calculatePay,
  canRefreshFromImport,
  payPeriodContaining,
  priorPayPeriod,
  type ApprovalStatus,
  type PayType,
} from "@/lib/domain/payroll";
import {
  addDays,
  dbDateFromPlainDate,
  plainDateFromDbDate,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";

/* -------------------------------------------------------------------------- */
/* Periods                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The pay period row for a given week, created if it does not exist.
 *
 * The database enforces the Sunday→Saturday shape and the following-Friday
 * deposit, so a caller cannot invent a period of another shape even by mistake.
 */
export async function ensurePayPeriod(anyDateInWeek: PlainDate) {
  const period = payPeriodContaining(anyDateInWeek);

  return prisma.payrollPeriod.upsert({
    where: { periodStart: dbDateFromPlainDate(period.start) },
    update: {},
    create: {
      periodStart: dbDateFromPlainDate(period.start),
      periodEnd: dbDateFromPlainDate(period.end),
      depositDate: dbDateFromPlainDate(period.depositDate),
    },
  });
}

/** The week Monday's import is for. */
export async function ensurePriorPayPeriod() {
  const today = await businessToday();
  return ensurePayPeriod(priorPayPeriod(today).start);
}

export async function listPayPeriods(limit = 26) {
  return prisma.payrollPeriod.findMany({
    orderBy: { periodStart: "desc" },
    take: limit,
  });
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  periodStart: PlainDate;
  periodEnd: PlainDate;
  /** Raw entries written or refreshed. */
  entriesImported: number;
  /** Running timers, which have no end and cannot be paid. */
  runningSkipped: number;
  /** Approval rows created. */
  approvalsCreated: number;
  /** Approval rows whose hours were refreshed. */
  approvalsUpdated: number;
  /** Rows left alone because they were approved or already invoiced. */
  approvalsFrozen: number;
  /** Contractors that could not be read, with the reason. */
  failures: { contractorName: string; message: string }[];
}

/**
 * Pulls Clockify time for one pay period and rebuilds the approval rows.
 *
 * Only completed entries count. A timer still running has no end instant, so
 * there is no duration to pay — it is counted and reported rather than guessed
 * at, because a silently-omitted shift is how someone gets underpaid.
 */
export async function importPayPeriod(
  periodStart: PlainDate,
  actor: ActorContext,
): Promise<ImportResult> {
  const settings = await getSettings();

  if (!settings.clockifyEnabled || !settings.clockifyWorkspaceId) {
    throw validationError("Clockify is not configured. Set it up in Settings first.");
  }
  if (!isClockifyConfigured()) {
    throw validationError("CLOCKIFY_API_KEY is not set on the server.");
  }

  const period = await ensurePayPeriod(periodStart);
  if (period.closedAt) {
    throw conflict("That pay period is closed. Reopen it before importing again.");
  }

  const start = plainDateFromDbDate(period.periodStart);
  const end = plainDateFromDbDate(period.periodEnd);

  const contractors = await prisma.contractor.findMany({
    where: { active: true, clockifyUserId: { not: null } },
    orderBy: { name: "asc" },
  });

  const workspaceId = settings.clockifyWorkspaceId;
  // The window is the whole business week: from the start of Sunday to the
  // start of the following Sunday, exclusive.
  const from = startOfBusinessDay(start, settings.timeZone);
  const to = startOfBusinessDay(addDays(end, 1), settings.timeZone);

  const result: ImportResult = {
    periodStart: start,
    periodEnd: end,
    entriesImported: 0,
    runningSkipped: 0,
    approvalsCreated: 0,
    approvalsUpdated: 0,
    approvalsFrozen: 0,
    failures: [],
  };

  for (const contractor of contractors) {
    let secondsThisWeek = 0;

    try {
      const entries = await getTimeEntries(workspaceId, contractor.clockifyUserId!, {
        start: from,
        end: to,
      });

      for (const entry of entries) {
        const startedAt = entry.timeInterval.start;
        const endedAt = entry.timeInterval.end;

        // A running timer. Reported, never guessed at.
        if (!endedAt) {
          result.runningSkipped += 1;
          continue;
        }

        const seconds = Math.round(
          (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
        );
        // Clockify has been known to return zero-length entries; they are not
        // work, and the database rejects them anyway.
        if (seconds <= 0) continue;

        secondsThisWeek += seconds;

        // Keyed on Clockify's id, which is what makes re-import idempotent.
        await prisma.importedTimeEntry.upsert({
          where: { clockifyEntryId: entry.id },
          update: {
            payrollPeriodId: period.id,
            contractorId: contractor.id,
            startTime: new Date(startedAt),
            endTime: new Date(endedAt),
            durationSeconds: seconds,
            description: entry.description || null,
            importedAt: new Date(),
          },
          create: {
            payrollPeriodId: period.id,
            contractorId: contractor.id,
            clockifyEntryId: entry.id,
            clockifyUserId: contractor.clockifyUserId!,
            startTime: new Date(startedAt),
            endTime: new Date(endedAt),
            durationSeconds: seconds,
            description: entry.description || null,
          },
        });

        result.entriesImported += 1;
      }
    } catch (error) {
      // One unreachable contractor must not abandon the rest of the payroll.
      result.failures.push({
        contractorName: contractor.name,
        message: error instanceof Error ? error.message : "Could not read Clockify.",
      });
      continue;
    }

    const outcome = await upsertApproval(period.id, contractor, secondsThisWeek);
    if (outcome === "created") result.approvalsCreated += 1;
    else if (outcome === "updated") result.approvalsUpdated += 1;
    else result.approvalsFrozen += 1;
  }

  await recordAudit({
    ...auditActor(actor),
    entityType: "PAYROLL_PERIOD",
    entityId: period.id,
    action: "IMPORTED",
    newValue: {
      periodStart: start,
      entriesImported: result.entriesImported,
      runningSkipped: result.runningSkipped,
      approvalsCreated: result.approvalsCreated,
      approvalsUpdated: result.approvalsUpdated,
      approvalsFrozen: result.approvalsFrozen,
      failures: result.failures.length,
    },
  });

  return result;
}

type UpsertOutcome = "created" | "updated" | "frozen";

/**
 * Creates or refreshes one contractor's row for a week.
 *
 * Rates are copied onto the row rather than read live later. A raise must not
 * restate a week that has already been signed off.
 */
async function upsertApproval(
  payrollPeriodId: string,
  contractor: {
    id: string;
    payType: PayType;
    weeklyAmount: Decimal | null;
    hourlyRate: Decimal | null;
  },
  seconds: number,
): Promise<UpsertOutcome> {
  const existing = await prisma.weeklyApproval.findUnique({
    where: { payrollPeriodId_contractorId: { payrollPeriodId, contractorId: contractor.id } },
    select: { id: true, managerStatus: true, invoiceId: true },
  });

  const invoiceAmount = calculatePay({
    payType: contractor.payType,
    seconds,
    weeklyAmount: contractor.weeklyAmount,
    hourlyRate: contractor.hourlyRate,
  });

  if (!existing) {
    await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId,
        contractorId: contractor.id,
        payType: contractor.payType,
        clockifySeconds: seconds,
        weeklyAmount: contractor.weeklyAmount,
        hourlyRate: contractor.hourlyRate,
        invoiceAmount,
      },
    });
    return "created";
  }

  if (
    !canRefreshFromImport({
      managerStatus: existing.managerStatus as ApprovalStatus,
      invoiceId: existing.invoiceId,
    })
  ) {
    return "frozen";
  }

  await prisma.weeklyApproval.update({
    where: { id: existing.id },
    data: {
      payType: contractor.payType,
      clockifySeconds: seconds,
      weeklyAmount: contractor.weeklyAmount,
      hourlyRate: contractor.hourlyRate,
      invoiceAmount,
    },
  });

  return "updated";
}

/* -------------------------------------------------------------------------- */
/* Approval                                                                   */
/* -------------------------------------------------------------------------- */

export async function listApprovals(payrollPeriodId: string) {
  return prisma.weeklyApproval.findMany({
    where: { payrollPeriodId },
    include: {
      contractor: { select: { id: true, name: true, invoicePrefix: true } },
      approvedBy: { select: { displayName: true, color: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true, pdfUrl: true } },
    },
    orderBy: { contractor: { name: "asc" } },
  });
}

/**
 * Records a manager's decision on one row.
 *
 * An invoiced row is frozen: correcting it means voiding the invoice first,
 * which is a deliberate act with a reason attached rather than an edit that
 * leaves an invoice describing something that is no longer true.
 */
export async function setApprovalStatus(
  approvalId: string,
  status: ApprovalStatus,
  actor: ActorContext,
  reviewNote?: string | null,
) {
  const existing = await prisma.weeklyApproval.findUnique({
    where: { id: approvalId },
    select: { id: true, managerStatus: true, invoiceId: true, contractorId: true },
  });
  if (!existing) throw notFound("That payroll row no longer exists.");

  if (existing.invoiceId) {
    throw conflict(
      "That row has already been invoiced. Void the invoice before changing its approval.",
    );
  }

  const approving = status === "APPROVED";

  const updated = await prisma.weeklyApproval.update({
    where: { id: approvalId },
    data: {
      managerStatus: status,
      // The database requires approver and timestamp to travel with APPROVED,
      // and to be absent otherwise.
      approvedById: approving ? actor.effective.id : null,
      approvedAt: approving ? new Date() : null,
      reviewNote: reviewNote?.trim() || null,
    },
    include: { contractor: { select: { name: true } } },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "WEEKLY_APPROVAL",
    entityId: approvalId,
    action: `APPROVAL_${status}`,
    oldValue: { managerStatus: existing.managerStatus },
    newValue: { managerStatus: status, contractor: updated.contractor.name },
  });

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                    */
/* -------------------------------------------------------------------------- */

export interface PayrollSummary {
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
  approvedTotal: Decimal;
  invoicedTotal: Decimal;
  paidTotal: Decimal;
}

export async function getPayrollSummary(payrollPeriodId: string): Promise<PayrollSummary> {
  const period = await prisma.payrollPeriod.findUnique({ where: { id: payrollPeriodId } });
  if (!period) throw notFound("That pay period no longer exists.");

  const approvals = await prisma.weeklyApproval.findMany({
    where: { payrollPeriodId },
    select: { managerStatus: true, clockifySeconds: true, invoiceAmount: true, invoiceId: true },
  });

  const invoices = await prisma.invoice.findMany({
    where: { payrollPeriodId, status: { not: "VOID" } },
    select: { amount: true, status: true },
  });

  const sum = (values: Decimal[]) =>
    values.reduce((total, value) => total.plus(value), new Decimal(0));

  return {
    periodStart: plainDateFromDbDate(period.periodStart),
    periodEnd: plainDateFromDbDate(period.periodEnd),
    depositDate: plainDateFromDbDate(period.depositDate),
    contractors: approvals.length,
    totalSeconds: approvals.reduce((total, row) => total + row.clockifySeconds, 0),
    pending: approvals.filter((row) => row.managerStatus === "PENDING").length,
    approved: approvals.filter((row) => row.managerStatus === "APPROVED").length,
    rejected: approvals.filter((row) => row.managerStatus === "REJECTED").length,
    needsReview: approvals.filter((row) => row.managerStatus === "NEEDS_REVIEW").length,
    invoiced: approvals.filter((row) => row.invoiceId !== null).length,
    approvedTotal: sum(
      approvals.filter((row) => row.managerStatus === "APPROVED").map((row) => row.invoiceAmount),
    ),
    invoicedTotal: sum(invoices.map((row) => row.amount)),
    paidTotal: sum(invoices.filter((row) => row.status === "PAID").map((row) => row.amount)),
  };
}

/** Resolves a period by its Sunday, for URLs like `?period=2026-07-05`. */
export async function findPeriodByStart(periodStart: string) {
  const parsed = toPlainDate(periodStart);
  return prisma.payrollPeriod.findUnique({
    where: { periodStart: dbDateFromPlainDate(parsed) },
  });
}
