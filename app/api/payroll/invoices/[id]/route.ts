import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { markInvoicePaid, markInvoiceSent, voidInvoice } from "@/lib/services/invoices";
import { invoiceActionSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every action here moves or unmakes money, so all of them are admin-only. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await context.params;
    const input = invoiceActionSchema.parse(await readJson(request));

    switch (input.action) {
      case "MARK_PAID":
        return jsonOk({
          invoice: await markInvoicePaid(
            id,
            { paymentDate: input.paymentDate, usdtTxHash: input.usdtTxHash },
            actor,
          ),
        });
      case "MARK_SENT":
        return jsonOk({ invoice: await markInvoiceSent(id, actor) });
      case "VOID":
        return jsonOk({ invoice: await voidInvoice(id, input.reason, actor) });
    }
  });
}
