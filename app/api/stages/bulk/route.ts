import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { bulkUpdateReviewDue } from "@/lib/services/stages";
import { bulkReviewDueSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk review-due edit.
 *
 * Administrators only, matching the single-row rule. Moving many deadlines at
 * once is the higher-consequence version of the same action and is exactly the
 * kind of change that is expensive to unpick if it was not intended.
 */
export async function PATCH(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = bulkReviewDueSchema.parse(await readJson(request));
    return jsonOk(await bulkUpdateReviewDue(input, actor));
  });
}
