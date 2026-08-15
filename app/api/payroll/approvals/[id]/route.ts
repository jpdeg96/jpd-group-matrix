import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireManager } from "@/lib/auth/guards";
import { setApprovalStatus } from "@/lib/services/payroll";
import { approvalPatchSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Records a manager's decision on one contractor's week.
 *
 * Manager-and-above, which is the whole point: approving payroll is the
 * reviewer's job, and it happens here rather than in Clockify because Clockify
 * Basic has no approval step.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireManager();
    const { id } = await context.params;
    const input = approvalPatchSchema.parse(await readJson(request));

    const approval = await setApprovalStatus(
      id,
      input.managerStatus as Parameters<typeof setApprovalStatus>[1],
      actor,
      input.reviewNote,
    );

    return jsonOk({ approval });
  });
}
