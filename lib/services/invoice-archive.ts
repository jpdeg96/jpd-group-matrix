/**
 * Files invoice PDFs into Google Drive.
 *
 * Sits between the invoice services and the Drive client so that neither knows
 * about the other: `invoices.ts` asks for an invoice to be archived, and what
 * that means — whether it is switched on, which folder, what happens when it
 * fails — is decided here.
 *
 * ## Nothing here is allowed to fail an invoice
 *
 * Generating an invoice and emailing it are the operations that matter; filing
 * a copy is bookkeeping. So every function resolves, records the outcome on the
 * invoice row, and leaves the caller's path alone. `driveError` on the row is
 * what turns a silent failure into something an administrator can see and
 * retry, which is the difference between a background job and a black hole.
 */

import { prisma } from "@/lib/db/prisma";
import { getSettings } from "./settings";
import { buildInvoicePdf } from "./invoice-pdf";
import { DriveError, isDriveConfigured, uploadPdf } from "./google-drive";

export interface ArchiveOutcome {
  invoiceId: string;
  uploaded: boolean;
  /** Set when it did not go up. Safe to show an administrator. */
  error?: string;
  webViewLink?: string;
}

/** Both halves have to be true, and a folder has to be named. */
export async function isArchivingEnabled(): Promise<boolean> {
  const settings = await getSettings();
  return settings.driveUploadEnabled && Boolean(settings.driveFolderId) && isDriveConfigured();
}

/**
 * Uploads one invoice, replacing any earlier copy of the same number.
 *
 * Re-running is safe and is the retry path: a reissued or corrected invoice
 * overwrites its own file rather than leaving two documents with one number.
 */
export async function archiveInvoice(invoiceId: string): Promise<ArchiveOutcome> {
  const settings = await getSettings();

  if (!settings.driveUploadEnabled) {
    return { invoiceId, uploaded: false, error: "Drive archiving is switched off in Settings." };
  }
  if (!settings.driveFolderId) {
    return { invoiceId, uploaded: false, error: "No Drive folder has been set in Settings." };
  }

  try {
    const pdf = await buildInvoicePdf(invoiceId);
    const result = await uploadPdf({
      folderId: settings.driveFolderId,
      filename: pdf.filename,
      bytes: pdf.bytes,
    });

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        driveFileId: result.fileId,
        driveWebLink: result.webViewLink,
        driveUploadedAt: new Date(),
        driveError: null,
      },
    });

    return { invoiceId, uploaded: true, webViewLink: result.webViewLink };
  } catch (error) {
    const message =
      error instanceof DriveError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not upload to Drive.";

    // Recording the reason is the whole point; if even that fails there is
    // nothing useful left to do, and it must not become the thing that throws.
    await prisma.invoice
      .update({ where: { id: invoiceId }, data: { driveError: message } })
      .catch(() => undefined);

    console.warn(`[drive] invoice ${invoiceId} not archived:`, message);
    return { invoiceId, uploaded: false, error: message };
  }
}

/**
 * Archives several invoices one after another.
 *
 * Sequential on purpose. A payroll run is a handful of documents against an API
 * with per-user rate limits, and uploading them in parallel buys a second at
 * the cost of a 429 that fails several at once.
 */
export async function archiveInvoices(invoiceIds: string[]): Promise<ArchiveOutcome[]> {
  if (invoiceIds.length === 0) return [];
  if (!(await isArchivingEnabled())) return [];

  const outcomes: ArchiveOutcome[] = [];
  for (const invoiceId of invoiceIds) {
    outcomes.push(await archiveInvoice(invoiceId));
  }
  return outcomes;
}

/**
 * How many invoices have no copy in Drive.
 *
 * Counts everything ever issued, including voided ones: a voided invoice is
 * still part of the record, and the PDF stamps VOID across itself, so the
 * folder is complete without being misleading. Ones that previously failed are
 * counted too — they are exactly what a retry is for.
 */
export function countUnfiled(): Promise<number> {
  return prisma.invoice.count({ where: { driveFileId: null } });
}

/**
 * Rendering and filing every invoice generated before archiving was switched on
 * takes seconds each, so a single request cannot safely do an unbounded number
 * of them. This does a batch and reports what is left; pressing again continues.
 */
const BATCH_SIZE = 25;

export interface BackfillResult {
  uploaded: number;
  failed: number;
  /** Still without a copy after this batch. */
  remaining: number;
  /** First failure, so a systemic problem is visible without a log dive. */
  firstError: string | null;
}

/**
 * Files invoices that predate Drive archiving being switched on.
 *
 * Oldest first, so the folder fills in the order the invoices were issued
 * rather than backwards. Safe to run repeatedly — anything already filed is
 * skipped by the query, and an upload replaces its own file rather than adding
 * a second one.
 */
export async function backfillArchive(): Promise<BackfillResult> {
  const settings = await getSettings();

  if (!settings.driveUploadEnabled || !settings.driveFolderId) {
    throw new Error("Switch on Drive archiving and set a folder first.");
  }

  const pending = await prisma.invoice.findMany({
    where: { driveFileId: null },
    orderBy: { generatedAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  const outcomes: ArchiveOutcome[] = [];
  for (const invoice of pending) {
    outcomes.push(await archiveInvoice(invoice.id));
  }

  const failures = outcomes.filter((outcome) => !outcome.uploaded);

  return {
    uploaded: outcomes.filter((outcome) => outcome.uploaded).length,
    failed: failures.length,
    remaining: await countUnfiled(),
    firstError: failures[0]?.error ?? null,
  };
}
