import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createUser, listSelectableUsers, listUsers } from "@/lib/services/users";
import { createUserSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regular users get the assignee picker list only. Full records — role, whether
 * a password is set, assignment counts — are administrator-only.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const actor = await requireUser();

    const scope = request.nextUrl.searchParams.get("scope");
    if (actor.effective.role !== "ADMIN" || scope === "assignable") {
      return jsonOk({ users: await listSelectableUsers() });
    }

    return jsonOk({ users: await listUsers() });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const actor = await requireAdmin();
    const input = createUserSchema.parse(await readJson(request));
    return jsonOk({ user: await createUser(input, actor) }, { status: 201 });
  });
}
