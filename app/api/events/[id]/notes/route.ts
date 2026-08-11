import { NextRequest } from "next/server";
import { handle, jsonOk, readJson } from "@/lib/api/respond";
import { requireUser } from "@/lib/auth/guards";
import { addNote, listNotes } from "@/lib/services/notes";
import { createNoteSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    return jsonOk({ notes: await listNotes(id) });
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const { body } = createNoteSchema.parse(await readJson(request));
    return jsonOk({ note: await addNote(id, body, actor) }, { status: 201 });
  });
}
