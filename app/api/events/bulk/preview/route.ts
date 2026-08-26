import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireRole } from "@/lib/auth/guards";
import { planBulkUpdate } from "@/lib/services/bulk-events";
import { bulkEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Works out what a bulk change would do, and writes nothing.
 *
 * A POST rather than a GET because the body is a set of ids and values that
 * would not survive a query string, and because it is the same body the apply
 * takes — the review screen and the action must not be able to describe
 * different things. It remains side-effect free.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireRole("MANAGER");
    const input = bulkEventSchema.parse(await readJson(request));
    return jsonOk({ plan: await planBulkUpdate(input, actor) });
  });
}
