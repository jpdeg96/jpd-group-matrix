import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { importPayPeriod } from "@/lib/services/payroll";
import { importSchema } from "@/lib/validation/payroll-schemas";
import { businessToday } from "@/lib/services/settings";
import { priorPayPeriod } from "@/lib/domain/payroll";
import { toPlainDate } from "@/lib/date/plain-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pulls Clockify time for a pay week.
 *
 * Manager and above. This was administrator-only on the reasoning that
 * importing rewrites the hours a manager is about to approve — but that
 * separation is enforced by the data rather than by the role: a row that has
 * been approved or invoiced is frozen against a re-import (see
 * `canRefreshFromImport`), and comes back in the result as `approvalsFrozen`
 * instead of being restated. So the worst a manager can do to their own review
 * is refresh the rows they have not signed off yet, which is the point of
 * importing.
 *
 * Generating invoices and sending remittance stay with administrators. Those
 * move money; this prepares a week for someone to look at.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireManager();
    const input = importSchema.parse(await readJson(request));

    // Any date inside the week works — the service resolves it to that week's
    // Sunday, so a caller cannot half-specify a period.
    const periodStart = input.periodStart
      ? toPlainDate(input.periodStart)
      : priorPayPeriod(await businessToday()).start;

    return jsonOk({ result: await importPayPeriod(periodStart, actor) });
  });
}
