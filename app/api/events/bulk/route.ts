import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireRole } from "@/lib/auth/guards";
import { applyBulkUpdate } from "@/lib/services/bulk-events";
import { bulkEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Applies a bulk change.
 *
 * Takes the same body as the preview and recomputes the plan from scratch, so
 * the review screen is a way of seeing what will happen rather than a source of
 * instructions — nothing the browser decided is trusted here.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireRole("MANAGER");
    const input = bulkEventSchema.parse(await readJson(request));
    return jsonOk({ result: await applyBulkUpdate(input, actor) });
  });
}
