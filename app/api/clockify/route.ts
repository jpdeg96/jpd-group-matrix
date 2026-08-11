import { handle, jsonOk } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { getClockifySummary } from "@/lib/services/clockify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Time summary for the signed-in user, plus who else is clocked in.
 *
 * Polled by the header widget. Always returns 200 with an `error` field rather
 * than a failure status: Clockify being down should grey out a chip, not make
 * the client think the request was malformed.
 */
export async function GET() {
  return handle(async () => {
    const actor = await requireUser();
    return jsonOk({ clockify: await getClockifySummary(actor.effective.id) });
  });
}
