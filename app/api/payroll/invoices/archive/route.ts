import { handle, jsonOk } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { validationError } from "@/lib/errors";
import { auditActor } from "@/lib/auth/actor";
import { recordAudit } from "@/lib/services/audit";
import { backfillArchive, countUnfiled } from "@/lib/services/invoice-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Files invoices that have no copy in Drive.
 *
 * Covers two cases with one action: invoices generated before archiving was
 * switched on, and ones whose upload failed and needs retrying. Both are just
 * "invoice with no Drive copy", so there is no reason to make them separate
 * buttons.
 *
 * Works in batches and reports what is left rather than trying to do an
 * unbounded number in one request — rendering a PDF and uploading it takes
 * seconds each, and a request that runs for minutes gets cut off by the host
 * with no record of how far it got.
 */
export async function POST() {
  return handle(async () => {
    const actor = await requireAdmin();

    const before = await countUnfiled();
    if (before === 0) {
      return jsonOk({ uploaded: 0, failed: 0, remaining: 0, firstError: null });
    }

    let result;
    try {
      result = await backfillArchive();
    } catch (error) {
      throw validationError(
        error instanceof Error ? error.message : "Could not file invoices to Drive.",
      );
    }

    if (result.uploaded > 0) {
      await recordAudit({
        ...auditActor(actor),
        entityType: "MAINTENANCE",
        entityId: "00000000-0000-0000-0000-000000000000",
        action: "INVOICES_ARCHIVED",
        newValue: {
          uploaded: result.uploaded,
          failed: result.failed,
          remaining: result.remaining,
        },
      });
    }

    return jsonOk(result);
  });
}
