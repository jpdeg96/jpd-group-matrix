import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/guards";
import { deleteRole, setRolePermissions, updateRole } from "@/lib/services/roles";
import { updateRoleSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Rename a role, or replace its permissions.
 *
 * Permissions arrive as the whole set rather than as adds and removes, because
 * the editor shows the whole set — sending a diff from a screen that renders a
 * snapshot is how two people editing at once silently merge into something
 * neither chose.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    const input = updateRoleSchema.parse(await readJson(request));

    if (input.permissions !== undefined) {
      return jsonOk({ role: await setRolePermissions(id, input.permissions, actor) });
    }
    return jsonOk({ role: await updateRole(id, input, actor) });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requirePermission("users.manage");
    const { id } = await params;
    await deleteRole(id, actor);
    return jsonOk({ deleted: true });
  });
}
