import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { deleteNote, updateNote } from "@/lib/services/notes";
import { updateNoteSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Authors edit their own notes; administrators may edit any. */
export async function PATCH(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const { body } = updateNoteSchema.parse(await readJson(request));
    return jsonOk({ note: await updateNote(id, body, actor) });
  });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    await deleteNote(id, actor);
    return jsonOk({ deleted: true });
  });
}
