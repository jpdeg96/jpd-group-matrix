import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { listSeedableUsers, seedContractorsFromUsers } from "@/lib/services/contractors";
import { seedContractorsSchema } from "@/lib/validation/payroll-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Users who could become contractors, each with a free prefix suggested. */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return jsonOk({ users: await listSeedableUsers() });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = seedContractorsSchema.parse(await readJson(request));

    const result = await seedContractorsFromUsers(
      input.people as Parameters<typeof seedContractorsFromUsers>[0],
      actor,
    );

    return jsonOk({ result });
  });
}
