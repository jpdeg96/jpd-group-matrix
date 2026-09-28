import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guards";
import { createContractor, listContractors } from "@/lib/services/contractors";
import { contractorSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requirePermission("payroll.view");
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";
    return jsonOk({ contractors: await listContractors({ includeInactive }) });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requirePermission("payroll.manageContractors");
    const input = contractorSchema.parse(await readJson(request));

    const contractor = await createContractor(
      input as Parameters<typeof createContractor>[0],
      actor,
    );

    return jsonOk({ contractor }, { status: 201 });
  });
}
