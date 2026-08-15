import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { sendRemittanceForPeriod } from "@/lib/services/remittance";
import { remittanceSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends remittance emails for a pay period.
 *
 * Administrator-only, and the service refuses anything but the latest period
 * unless `allowOlderPeriod` is set — mailing contractors about a week that was
 * settled months ago is the mistake most worth making impossible by accident.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = remittanceSchema.parse(await readJson(request));

    const result = await sendRemittanceForPeriod(input.payrollPeriodId, actor, {
      allowOlderPeriod: input.allowOlderPeriod,
      resend: input.resend,
    });

    return jsonOk({ result });
  });
}
