import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { createManualInvoice } from "@/lib/services/invoices";
import { manualInvoiceSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Raises a one-off invoice.
 *
 * Administrator-only, like generating a payroll run: this creates money, and it
 * skips the approval step that every other invoice passes through, so the
 * restriction is doing more work here than usual.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = manualInvoiceSchema.parse(await readJson(request));

    const result = await createManualInvoice(
      {
        contractorId: input.contractorId,
        payrollPeriodId: input.payrollPeriodId,
        description: input.description,
        amount: input.amount,
      },
      actor,
      { confirmLargeAmounts: input.confirmLargeAmounts },
    );

    return jsonOk(result);
  });
}
