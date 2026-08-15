import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { deactivateContractor, updateContractor } from "@/lib/services/contractors";
import { contractorSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await context.params;
    const input = contractorSchema.parse(await readJson(request));

    const contractor = await updateContractor(
      id,
      input as Parameters<typeof updateContractor>[1],
      actor,
    );

    return jsonOk({ contractor });
  });
}

/**
 * Deactivates rather than deletes.
 *
 * A contractor who has ever been paid is referenced by invoices with
 * `Restrict`, so the row cannot go without taking payment history with it.
 * Deactivating removes them from next week's import and keeps the record.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await context.params;
    return jsonOk({ contractor: await deactivateContractor(id, actor) });
  });
}
