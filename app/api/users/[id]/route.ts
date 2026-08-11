import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { updateUser } from "@/lib/services/users";
import { updateUserSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await params;
    const input = updateUserSchema.parse(await readJson(request));
    return jsonOk({ user: await updateUser(id, input, actor) });
  });
}

// There is no DELETE. Users are referenced by assignments, completions and
// notes; removing a row would erase the record of who did the work.
// Deactivation is the removal path.
