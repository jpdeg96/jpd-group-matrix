import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth/guards";
import { deleteEventType, updateEventType } from "@/lib/services/event-types";
import { updateEventTypeSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await params;
    const input = updateEventTypeSchema.parse(await readJson(request));
    return jsonOk({ type: await updateEventType(id, input, actor.real.id) });
  });
}

/** Only permitted while unused; a type in use must be deactivated instead. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireAdmin();
    const { id } = await params;
    await deleteEventType(id, actor.real.id);
    return jsonOk({ deleted: true });
  });
}
