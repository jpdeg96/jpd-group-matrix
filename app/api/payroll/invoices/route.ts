import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guards";
import { generateInvoicesForPeriod, listInvoices } from "@/lib/services/invoices";
import { generateInvoicesSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requirePermission("payroll.view");
    const payrollPeriodId = request.nextUrl.searchParams.get("period") ?? undefined;
    return jsonOk({ invoices: await listInvoices({ payrollPeriodId }) });
  });
}

/** Generating invoices is administrator-only: it is the step that creates money. */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requirePermission("payroll.invoice");
    const input = generateInvoicesSchema.parse(await readJson(request));

    const result = await generateInvoicesForPeriod(input.payrollPeriodId, actor, {
      confirmLargeAmounts: input.confirmLargeAmounts,
    });

    return jsonOk({ result });
  });
}
