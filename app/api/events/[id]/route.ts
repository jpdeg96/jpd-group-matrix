import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { deleteEvent, getEvent, updateEvent } from "@/lib/services/events";
import { updateEventSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    return jsonOk({ event: await getEvent(id) });
  });
}

/**
 * Partial update.
 *
 * Only the fields present in the body are written, so two people editing
 * different cells of the same row cannot overwrite each other.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const input = updateEventSchema.parse(await readJson(request));
    return jsonOk(await updateEvent(id, input, actor));
  });
}

/** Deleting from the dashboard removes the event from C1 too, via the cascade. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    return jsonOk(await deleteEvent(id, actor));
  });
}
