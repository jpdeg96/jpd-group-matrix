import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guards";
import { createRole, listRoles } from "@/lib/services/roles";
import { createRoleSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Roles and their grants.
 *
 * Behind `users.manage` in both directions: who may do what is exactly as
 * sensitive as who the users are, and a role editor readable by somebody who
 * cannot change it is a map of where the doors are.
 */
export async function GET() {
  return handle(async () => {
    await requirePermission("users.manage");
    return jsonOk({ roles: await listRoles() });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requirePermission("users.manage");
    const input = createRoleSchema.parse(await readJson(request));
    return jsonOk({ role: await createRole(input, actor) }, { status: 201 });
  });
}
