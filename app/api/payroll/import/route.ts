import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
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
 * Administrator-only: importing rewrites the hours a manager is about to
 * approve, so it is not something a reviewer should be able to do underneath
 * their own review.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = importSchema.parse(await readJson(request));

    // Any date inside the week works — the service resolves it to that week's
    // Sunday, so a caller cannot half-specify a period.
    const periodStart = input.periodStart
      ? toPlainDate(input.periodStart)
      : priorPayPeriod(await businessToday()).start;

    return jsonOk({ result: await importPayPeriod(periodStart, actor) });
  });
}
